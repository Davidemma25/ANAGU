const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AnaguLandTitle ERC-721 & Regulated Polygon Marketplace', function () {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const registrar = signers[0];
    const citizen = signers[1];
    const buyer = signers[2];
    const governor = signers[5];

    const Factory = await ethers.getContractFactory('AnaguLandTitle', registrar);
    const contract = await Factory.deploy(registrar.address, registrar.address, governor.address);
    await contract.waitForDeployment();

    return { contract, registrar, citizen, buyer, governor };
  }

  it('restricts title issuance to REGISTRAR_ROLE and preserves metadata', async function () {
    const { contract, registrar, citizen } = await deployFixture();

    await expect(
      contract
        .connect(citizen)
        .issueTitle(citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1')
    ).to.be.reverted;

    await expect(
      contract
        .connect(registrar)
        .issueTitle(citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1')
    )
      .to.emit(contract, 'TitleIssued')
      .withArgs(1, citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1', registrar.address);

    expect(await contract.ownerOf(1)).to.equal(citizen.address);
    const title = await contract.getTitle(1);
    expect(title.parcelCode).to.equal('ANG-PARCEL-0001');
    expect(title.status).to.equal(0); // Active
  });

  it('blocks direct owner-to-owner transferFrom / safeTransferFrom calls', async function () {
    const { contract, registrar, citizen, buyer } = await deployFixture();
    await contract
      .connect(registrar)
      .issueTitle(citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1');

    await expect(
      contract.connect(citizen).transferFrom(citizen.address, buyer.address, 1)
    ).to.be.revertedWithCustomError(contract, 'TransferBlockedByRegistryRule');

    await expect(
      contract
        .connect(citizen)
        ['safeTransferFrom(address,address,uint256)'](citizen.address, buyer.address, 1)
    ).to.be.revertedWithCustomError(contract, 'TransferBlockedByRegistryRule');
  });

  it('supports regulated Polygon wallet listing, escrow funding, and seller sale confirmation', async function () {
    const { contract, registrar, citizen, buyer } = await deployFixture();
    await contract
      .connect(registrar)
      .issueTitle(citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1');

    const priceWei = ethers.parseEther('2.5');
    await expect(contract.connect(citizen).listParcelForSale(1, priceWei))
      .to.emit(contract, 'ParcelListed')
      .withArgs(1, citizen.address, priceWei);

    await expect(contract.connect(buyer).buyListedParcel(1, { value: priceWei }))
      .to.emit(contract, 'EscrowFunded')
      .withArgs(1, buyer.address, priceWei);

    const sellerBalanceBefore = await ethers.provider.getBalance(citizen.address);

    const settlement = await contract.connect(citizen).settleApprovedSale(1);
    await expect(settlement.wait())
      .to.emit(contract, 'SaleSettled')
      .withArgs(1, citizen.address, buyer.address, priceWei);

    const sellerBalanceAfter = await ethers.provider.getBalance(citizen.address);
    const receipt = await settlement.wait();
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    expect(sellerBalanceAfter - sellerBalanceBefore + gasCost).to.equal(priceWei);
    expect(await contract.ownerOf(1)).to.equal(buyer.address);

    const history = await contract.getTransferHistory(1);
    expect(history.length).to.equal(2);
    expect(history[1].transferType).to.equal('REGULATED_ESCROW_SALE');
  });

  it('allows only the listing seller to settle a funded sale', async function () {
    const { contract, registrar, citizen, buyer } = await deployFixture();
    await contract
      .connect(registrar)
      .issueTitle(citizen.address, 'ANG-PARCEL-0002', 'ANG-APP-2026-0002', 'ipfs://anagu/2');
    const priceWei = ethers.parseEther('1.0');
    await contract.connect(citizen).listParcelForSale(1, priceWei);
    await contract.connect(buyer).buyListedParcel(1, { value: priceWei });

    await expect(contract.connect(buyer).settleApprovedSale(1))
      .to.be.revertedWithCustomError(contract, 'NotListingSeller')
      .withArgs(buyer.address, citizen.address);
    await expect(contract.connect(registrar).settleApprovedSale(1))
      .to.be.revertedWithCustomError(contract, 'NotListingSeller')
      .withArgs(registrar.address, citizen.address);
  });

  it('restricts statutory revocation to GOVERNOR_ROLE and blocks revoked title listing/transfer/reuse', async function () {
    const { contract, registrar, citizen, buyer, governor } = await deployFixture();
    await contract
      .connect(registrar)
      .issueTitle(citizen.address, 'ANG-PARCEL-0001', 'ANG-APP-2026-0001', 'ipfs://anagu/1');

    await expect(
      contract
        .connect(registrar)
        .revokeTitle(1, 1, 'Unauthorized revocation attempt by Registrar.')
    ).to.be.reverted;

    await expect(
      contract
        .connect(governor)
        .revokeTitle(1, 1, 'Compulsory acquisition for regional road corridor infrastructure.')
    ).to.emit(contract, 'TitleRevoked');

    const title = await contract.getTitle(1);
    expect(title.status).to.equal(1); // Revoked

    await expect(
      contract.connect(citizen).listParcelForSale(1, ethers.parseEther('1.0'))
    ).to.be.revertedWithCustomError(contract, 'TitleIsRevoked');

    await expect(
      contract.connect(citizen).transferFrom(citizen.address, buyer.address, 1)
    ).to.be.revertedWithCustomError(contract, 'TitleIsRevoked');
  });
});
