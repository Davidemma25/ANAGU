const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const signers = await hre.ethers.getSigners();
  const isLocal = hre.network.name === 'hardhat' || hre.network.name === 'localhost';

  const registrar = signers[0];
  if (!registrar) {
    throw new Error(
      `No deployer signer available for network "${hre.network.name}". Set REGISTRAR_PRIVATE_KEY in .env with test POL before deploying.`
    );
  }

  let governorAddress;
  if (isLocal) {
    governorAddress = (signers[5] || signers[0]).address;
  } else if (process.env.GOVERNOR_ADDRESS && hre.ethers.isAddress(process.env.GOVERNOR_ADDRESS)) {
    governorAddress = process.env.GOVERNOR_ADDRESS;
  } else if (process.env.GOVERNOR_PRIVATE_KEY) {
    governorAddress = new hre.ethers.Wallet(process.env.GOVERNOR_PRIVATE_KEY).address;
  } else {
    governorAddress = registrar.address;
  }

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  if (!isLocal) {
    const balanceWei = await hre.ethers.provider.getBalance(registrar.address);
    if (balanceWei === 0n) {
      throw new Error(
        `Deployer wallet ${registrar.address} has 0 balance on ${hre.network.name} (chainId=${chainId}). Fund it with test POL from a Polygon Amoy faucet first.`
      );
    }
  }

  const AnaguLandTitle = await hre.ethers.getContractFactory('AnaguLandTitle', registrar);
  const contract = await AnaguLandTitle.deploy(
    registrar.address,
    registrar.address,
    governorAddress
  );
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const artifact = await hre.artifacts.readArtifact('AnaguLandTitle');

  const outFile =
    hre.network.name === 'polygonAmoy' ? 'deployed-amoy-title.json' : 'deployed-local.json';
  const outPath = path.resolve(__dirname, '..', outFile);

  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: hre.network.name,
        chainId,
        contractAddress: address,
        registrarAddress: registrar.address,
        governorAddress,
        deployedAt: new Date().toISOString(),
        abi: artifact.abi,
      },
      null,
      2
    )
  );

  console.log(
    `AnaguLandTitle deployed on ${hre.network.name} (chainId=${chainId}) to ${address} (Registrar=${registrar.address}, Governor=${governorAddress})`
  );

  if (hre.network.name === 'polygonAmoy' && process.env.POLYGONSCAN_API_KEY) {
    console.log('Waiting 5 confirmations before Polygonscan Amoy verification...');
    const deployTx = contract.deploymentTransaction();
    if (deployTx) await deployTx.wait(5);
    await hre.run('verify:verify', {
      address,
      constructorArguments: [registrar.address, registrar.address, governorAddress],
    });
    console.log('Verified AnaguLandTitle on Polygonscan Amoy.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
