const { expect } = require('chai');
const { ethers } = require('hardhat');

async function signPaymentQuote({
  signer,
  chainId,
  contractAddress,
  registrationReference,
  quoteId,
  requiredAmountWei,
  expiresAt,
}) {
  const regRefHash = ethers.keccak256(ethers.toUtf8Bytes(registrationReference));
  const packed = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'bytes32', 'bytes32', 'uint256', 'uint64'],
    [chainId, contractAddress, regRefHash, quoteId, requiredAmountWei, expiresAt]
  );
  return signer.signMessage(ethers.getBytes(packed));
}

describe('AnaguPayment Native ETH Registration Fee Contract', function () {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const admin = signers[0];
    const quoteSigner = signers[1];
    const payer = signers[2];
    const otherUser = signers[3];
    const treasury = signers[4];

    const initialFeeWei = ethers.parseEther('0.003333');
    const Factory = await ethers.getContractFactory('AnaguPayment', admin);
    const contract = await Factory.deploy(admin.address, quoteSigner.address, initialFeeWei);
    await contract.waitForDeployment();

    const network = await ethers.provider.getNetwork();
    return {
      contract,
      contractAddress: await contract.getAddress(),
      chainId: Number(network.chainId),
      admin,
      quoteSigner,
      payer,
      otherUser,
      treasury,
      initialFeeWei,
    };
  }

  it('accepts valid native ETH quote payment, stores on-chain record, and emits PaymentReceived', async function () {
    const { contract, contractAddress, chainId, quoteSigner, payer } = await deployFixture();
    const ref = 'ANG-APP-2026-0009';
    const quoteId = ethers.id('quote-1');
    const amountWei = ethers.parseEther('0.0042');
    const latestBlock = await ethers.provider.getBlock('latest');
    const expiresAt = latestBlock.timestamp + 900;

    const signature = await signPaymentQuote({
      signer: quoteSigner,
      chainId,
      contractAddress,
      registrationReference: ref,
      quoteId,
      requiredAmountWei: amountWei,
      expiresAt,
    });

    await expect(
      contract.connect(payer).payWithQuote(ref, quoteId, amountWei, expiresAt, signature, {
        value: amountWei,
      })
    )
      .to.emit(contract, 'PaymentReceived')
      .withArgs(
        ethers.keccak256(ethers.toUtf8Bytes(ref)),
        ref,
        quoteId,
        payer.address,
        amountWei,
        (ts) => ts > 0n
      );

    expect(await contract.hasPaid(ref)).to.equal(true);
    expect(await contract.totalPaymentsCount()).to.equal(1n);
    const record = await contract.getPaymentByReference(ref);
    expect(record.registrationReference).to.equal(ref);
    expect(record.payer).to.equal(payer.address);
    expect(record.amountWei).to.equal(amountWei);
    expect(record.paid).to.equal(true);
  });

  it('rejects duplicate payments for the same registration reference', async function () {
    const { contract, payer, otherUser, initialFeeWei } = await deployFixture();
    const ref = 'ANG-APP-2026-0010';

    await contract.connect(payer).payRegistrationFee(ref, { value: initialFeeWei });

    await expect(
      contract.connect(otherUser).payRegistrationFee(ref, { value: initialFeeWei })
    ).to.be.revertedWithCustomError(contract, 'DuplicateRegistrationPayment');
  });

  it('rejects expired quotes, tampered amounts, and unauthorized signers', async function () {
    const { contract, contractAddress, chainId, quoteSigner, payer, otherUser } = await deployFixture();
    const ref = 'ANG-APP-2026-0011';
    const amountWei = ethers.parseEther('0.005');
    const latestBlock = await ethers.provider.getBlock('latest');

    const expiredAt = latestBlock.timestamp - 10;
    const expiredQuoteId = ethers.id('quote-expired');
    const expiredSig = await signPaymentQuote({
      signer: quoteSigner,
      chainId,
      contractAddress,
      registrationReference: ref,
      quoteId: expiredQuoteId,
      requiredAmountWei: amountWei,
      expiresAt: expiredAt,
    });

    await expect(
      contract.connect(payer).payWithQuote(ref, expiredQuoteId, amountWei, expiredAt, expiredSig, {
        value: amountWei,
      })
    ).to.be.revertedWithCustomError(contract, 'QuoteExpired');

    const validExpiry = latestBlock.timestamp + 900;
    const badQuoteId = ethers.id('quote-bad-signer');
    const rogueSig = await signPaymentQuote({
      signer: otherUser,
      chainId,
      contractAddress,
      registrationReference: ref,
      quoteId: badQuoteId,
      requiredAmountWei: amountWei,
      expiresAt: validExpiry,
    });

    await expect(
      contract.connect(payer).payWithQuote(ref, badQuoteId, amountWei, validExpiry, rogueSig, {
        value: amountWei,
      })
    ).to.be.revertedWithCustomError(contract, 'InvalidQuoteSignature');

    const goodQuoteId = ethers.id('quote-underpay');
    const goodSig = await signPaymentQuote({
      signer: quoteSigner,
      chainId,
      contractAddress,
      registrationReference: ref,
      quoteId: goodQuoteId,
      requiredAmountWei: amountWei,
      expiresAt: validExpiry,
    });

    await expect(
      contract.connect(payer).payWithQuote(ref, goodQuoteId, amountWei, validExpiry, goodSig, {
        value: ethers.parseEther('0.001'),
      })
    ).to.be.revertedWithCustomError(contract, 'InvalidPaymentAmount');
  });

  it('supports emergency pause/unpause and blocks direct ETH transfers', async function () {
    const { contract, admin, payer, initialFeeWei } = await deployFixture();
    const ref = 'ANG-APP-2026-0012';

    await expect(
      payer.sendTransaction({ to: await contract.getAddress(), value: initialFeeWei })
    ).to.be.revertedWithCustomError(contract, 'DirectEthTransferNotAllowed');

    await expect(contract.connect(payer).pause()).to.be.reverted;
    await contract.connect(admin).pause();

    await expect(
      contract.connect(payer).payRegistrationFee(ref, { value: initialFeeWei })
    ).to.be.revertedWithCustomError(contract, 'EnforcedPause');

    await contract.connect(admin).unpause();
    await contract.connect(payer).payRegistrationFee(ref, { value: initialFeeWei });
    expect(await contract.hasPaid(ref)).to.equal(true);
  });

  it('restricts fee configuration and treasury withdrawals to authorized roles', async function () {
    const { contract, admin, payer, treasury, initialFeeWei } = await deployFixture();
    const ref = 'ANG-APP-2026-0013';

    await expect(contract.connect(payer).setConfigurableFeeWei(ethers.parseEther('0.01'))).to.be.reverted;
    await contract.connect(payer).payRegistrationFee(ref, { value: initialFeeWei });

    await expect(contract.connect(payer).withdraw(payer.address, initialFeeWei)).to.be.reverted;

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    await expect(contract.connect(admin).withdraw(treasury.address, initialFeeWei))
      .to.emit(contract, 'FundsWithdrawn')
      .withArgs(treasury.address, initialFeeWei, admin.address);

    const treasuryAfter = await ethers.provider.getBalance(treasury.address);
    expect(treasuryAfter - treasuryBefore).to.equal(initialFeeWei);
  });
});
