const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const isLocal = hre.network.name === 'hardhat' || hre.network.name === 'localhost';
  if (!isLocal && hre.network.name !== 'polygonAmoy') {
    throw new Error('ANAGU token deployment is restricted to local development or Polygon Amoy.');
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No deployer signer available for "${hre.network.name}". Set REGISTRAR_PRIVATE_KEY in .env.`
    );
  }

  const treasuryAddress = isLocal
    ? process.env.ANAGU_TREASURY_ADDRESS || deployer.address
    : process.env.ANAGU_TREASURY_ADDRESS;
  if (!treasuryAddress || !hre.ethers.isAddress(treasuryAddress)) {
    throw new Error('Set ANAGU_TREASURY_ADDRESS to the treasury wallet before Amoy deployment.');
  }

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (!isLocal && chainId !== 80002) {
    throw new Error(`Refusing deployment: expected Polygon Amoy chain 80002, received ${chainId}.`);
  }

  const Token = await hre.ethers.getContractFactory('AnaguToken', deployer);
  const token = await Token.deploy(treasuryAddress);
  await token.waitForDeployment();
  const contractAddress = await token.getAddress();
  const artifact = await hre.artifacts.readArtifact('AnaguToken');
  const outputName = isLocal ? 'deployed-local-token.json' : 'deployed-amoy-token.json';
  const outputPath = path.resolve(__dirname, '..', outputName);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        network: hre.network.name,
        chainId,
        contractAddress,
        treasuryAddress,
        totalSupply: (await token.totalSupply()).toString(),
        decimals: Number(await token.decimals()),
        deployedAt: new Date().toISOString(),
        abi: artifact.abi,
      },
      null,
      2
    )
  );

  console.log(
    `AnaguToken deployed on ${hre.network.name} (chainId=${chainId}) to ${contractAddress}; treasury=${treasuryAddress}`
  );

  if (!isLocal && process.env.POLYGONSCAN_API_KEY) {
    const deployTx = token.deploymentTransaction();
    if (deployTx) await deployTx.wait(5);
    await hre.run('verify:verify', {
      address: contractAddress,
      constructorArguments: [treasuryAddress],
    });
    console.log('Verified AnaguToken on Polygonscan Amoy.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
