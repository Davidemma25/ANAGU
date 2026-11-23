const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error('No deployment signer available.');

  const tokenAddress = process.env.ANAGU_TOKEN_ADDRESS;
  const titleAddress = process.env.ANAGU_TITLE_CONTRACT_ADDRESS;
  const treasuryAddress = process.env.ANAGU_TREASURY_ADDRESS || deployer.address;
  if (!hre.ethers.isAddress(tokenAddress)) throw new Error('Set ANAGU_TOKEN_ADDRESS.');
  if (!hre.ethers.isAddress(titleAddress)) throw new Error('Set ANAGU_TITLE_CONTRACT_ADDRESS.');
  if (!hre.ethers.isAddress(treasuryAddress)) throw new Error('Set ANAGU_TREASURY_ADDRESS.');

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const isLocal = hre.network.name === 'hardhat' || hre.network.name === 'localhost';
  if (!isLocal && chainId !== 80002) throw new Error('ANAGU escrow deployment is restricted to Amoy.');

  const Escrow = await hre.ethers.getContractFactory('AnaguEscrow', deployer);
  const escrow = await Escrow.deploy(
    deployer.address,
    deployer.address,
    treasuryAddress,
    tokenAddress,
    titleAddress
  );
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  const title = await hre.ethers.getContractAt('AnaguLandTitle', titleAddress, deployer);
  const escrowRole = await title.ESCROW_ROLE();
  await (await title.grantRole(escrowRole, escrowAddress)).wait();

  const artifact = await hre.artifacts.readArtifact('AnaguEscrow');
  const outputName = isLocal ? 'deployed-local-escrow.json' : 'deployed-amoy-escrow.json';
  fs.writeFileSync(
    path.resolve(__dirname, '..', outputName),
    JSON.stringify({
      network: hre.network.name,
      chainId,
      contractAddress: escrowAddress,
      anaguTokenAddress: tokenAddress,
      titleContractAddress: titleAddress,
      treasuryAddress,
      deployedAt: new Date().toISOString(),
      abi: artifact.abi,
    }, null, 2)
  );

  console.log(`AnaguEscrow deployed to ${escrowAddress}; ESCROW_ROLE granted on title contract.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
