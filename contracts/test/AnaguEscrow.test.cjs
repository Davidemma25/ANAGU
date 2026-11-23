const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('AnaguEscrow ERC-20 marketplace', function () {
  async function deployFixture() {
    const [admin, treasury, seller, buyer, registrar] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('AnaguToken', admin);
    const token = await Token.deploy(treasury.address);
    await token.waitForDeployment();

    const Title = await ethers.getContractFactory('AnaguLandTitle', admin);
    const title = await Title.deploy(admin.address, registrar.address, admin.address);
    await title.waitForDeployment();
    await (
      await title.connect(registrar).issueTitle(
        seller.address,
        'ANG-PARCEL-ESCROW-1',
        'ANG-APP-ESCROW-1',
        'ipfs://anagu/escrow-1'
      )
    ).wait();

    const Escrow = await ethers.getContractFactory('AnaguEscrow', admin);
    const escrow = await Escrow.deploy(
      admin.address,
      registrar.address,
      treasury.address,
      await token.getAddress(),
      await title.getAddress()
    );
    await escrow.waitForDeployment();

    const escrowRole = await title.ESCROW_ROLE();
    await (await title.connect(admin).grantRole(escrowRole, await escrow.getAddress())).wait();

    await token.connect(treasury).transfer(buyer.address, ethers.parseEther('10000'));
    return { token, title, escrow, admin, treasury, seller, buyer, registrar };
  }

  it('funds, settles, pays 98/2, and transfers the NFT', async function () {
    const { token, title, escrow, treasury, seller, buyer, registrar } = await deployFixture();
    const price = ethers.parseEther('5000');
    const expiry = (await time.latest()) + 3600;

    await escrow.connect(seller).listParcel(1, price, expiry);
    await token.connect(buyer).approve(await escrow.getAddress(), price);
    await escrow.connect(buyer).fundEscrow(1);

    const sellerBefore = await token.balanceOf(seller.address);
    const treasuryBefore = await token.balanceOf(treasury.address);
    await escrow.connect(seller).settleSale(1);

    expect(await title.ownerOf(1)).to.equal(buyer.address);
    expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + ethers.parseEther('4900'));
    expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore + ethers.parseEther('100'));

    const listing = await escrow.getEscrow(1);
    expect(listing.status).to.equal(3); // Settled
  });

  it('requires sufficient allowance and prevents seller purchase', async function () {
    const { token, escrow, seller, buyer } = await deployFixture();
    const price = ethers.parseEther('100');
    const expiry = (await time.latest()) + 3600;
    await escrow.connect(seller).listParcel(1, price, expiry);

    await expect(escrow.connect(buyer).fundEscrow(1)).to.be.revertedWithCustomError(
      escrow,
      'IncorrectPaymentAmount'
    );
    await token.connect(buyer).approve(await escrow.getAddress(), price);
    await expect(escrow.connect(seller).fundEscrow(1)).to.be.revertedWithCustomError(
      escrow,
      'BuyerCannotBeSeller'
    );
  });

  it('refunds the full escrow after expiry with no commission', async function () {
    const { token, escrow, seller, buyer } = await deployFixture();
    const price = ethers.parseEther('200');
    const expiry = (await time.latest()) + 100;
    await escrow.connect(seller).listParcel(1, price, expiry);
    await token.connect(buyer).approve(await escrow.getAddress(), price);
    await escrow.connect(buyer).fundEscrow(1);

    const buyerBefore = await token.balanceOf(buyer.address);
    await time.increaseTo(expiry + 1);
    await escrow.connect(buyer).refundEscrow(1);

    expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + price);
    expect((await escrow.getEscrow(1)).status).to.equal(6); // Expired
  });

  it('allows only the seller to settle and supports emergency pause', async function () {
    const { token, escrow, admin, seller, buyer, registrar } = await deployFixture();
    const price = ethers.parseEther('300');
    const expiry = (await time.latest()) + 3600;
    await escrow.connect(seller).listParcel(1, price, expiry);
    await token.connect(buyer).approve(await escrow.getAddress(), price);
    await escrow.connect(buyer).fundEscrow(1);

    await expect(escrow.connect(buyer).settleSale(1))
      .to.be.revertedWithCustomError(escrow, 'NotSeller')
      .withArgs(buyer.address, seller.address);
    await expect(escrow.connect(registrar).settleSale(1))
      .to.be.revertedWithCustomError(escrow, 'NotSeller')
      .withArgs(registrar.address, seller.address);
    await escrow.connect(admin).pause();
    await expect(escrow.connect(seller).settleSale(1)).to.be.revertedWithCustomError(
      escrow,
      'EnforcedPause'
    );
  });
});
