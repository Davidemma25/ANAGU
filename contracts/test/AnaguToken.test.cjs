const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AnaguToken fixed-supply ERC-20', function () {
  async function deployFixture() {
    const [deployer, treasury, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('AnaguToken', deployer);
    const token = await Token.deploy(treasury.address);
    await token.waitForDeployment();
    return { token, treasury, recipient };
  }

  it('mints the fixed 100 million token supply to the treasury with 18 decimals', async function () {
    const { token, treasury } = await deployFixture();
    const expectedSupply = ethers.parseUnits('100000000', 18);

    expect(await token.name()).to.equal('ANAGU Token');
    expect(await token.symbol()).to.equal('ANAGU');
    expect(await token.decimals()).to.equal(18n);
    expect(await token.MAX_SUPPLY()).to.equal(expectedSupply);
    expect(await token.totalSupply()).to.equal(expectedSupply);
    expect(await token.balanceOf(treasury.address)).to.equal(expectedSupply);
    expect(
      token.interface.fragments.some(
        (fragment) => fragment.type === 'function' && fragment.name === 'mint'
      )
    ).to.equal(false);
  });

  it('rejects a zero treasury and supports standard event-emitting transfers', async function () {
    const [deployer, treasury, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory('AnaguToken', deployer);

    await expect(Token.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Token,
      'ZeroTreasuryAddress'
    );

    const { token } = await deployFixture();
    const amount = ethers.parseUnits('25', 18);
    await expect(token.connect(treasury).transfer(recipient.address, amount))
      .to.emit(token, 'Transfer')
      .withArgs(treasury.address, recipient.address, amount);
    expect(await token.balanceOf(recipient.address)).to.equal(amount);
  });
});
