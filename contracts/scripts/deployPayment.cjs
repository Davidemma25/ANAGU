const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const quoteSigner =
    process.env.PAYMENT_QUOTE_SIGNER_ADDRESS ||
    (process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY
      ? new hre.ethers.Wallet(process.env.PAYMENT_QUOTE_SIGNER_PRIVATE_KEY).address
      : deployer.address);

  // Configurable initial fallback fee in wei (default ~ 15,000 NGN at 4,500,000 NGN/ETH -> 0.003333 ETH)
  const testNgnFee = Number(process.env.REGISTRATION_FEE_TEST_NGN || 15000);
  const ethNgnRate = Number(process.env.ETH_NGN_EXCHANGE_RATE || 4500000);
  const initialEth = (testNgnFee / ethNgnRate).toFixed(6);
  const initialFeeWei = hre.ethers.parseEther(initialEth);

  const AnaguPayment = await hre.ethers.getContractFactory('AnaguPayment', deployer);
  const contract = await AnaguPayment.deploy(deployer.address, quoteSigner, initialFeeWei);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  const outFile =
    hre.network.name === 'sepolia' ? 'deployed-sepolia-payment.json' : 'deployed-payment-local.json';
  const outPath = path.resolve(__dirname, '..', outFile);

  const artifact = await hre.artifacts.readArtifact('AnaguPayment');
  const payload = {
    network: hre.network.name,
    chainId,
    contractAddress,
    adminAddress: deployer.address,
    quoteSignerAddress: quoteSigner,
    initialFeeWei: initialFeeWei.toString(),
    initialFeeEth: initialEth,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(
    `AnaguPayment deployed on ${hre.network.name} (chainId=${chainId}) at ${contractAddress} | quoteSigner=${quoteSigner}`
  );

  if (hre.network.name === 'sepolia' && process.env.ETHERSCAN_API_KEY) {
    console.log('Waiting 5 confirmations before Etherscan verification...');
    const deployTx = contract.deploymentTransaction();
    if (deployTx) await deployTx.wait(5);
    await hre.run('verify:verify', {
      address: contractAddress,
      constructorArguments: [deployer.address, quoteSigner, initialFeeWei],
    });
    console.log('Verified AnaguPayment on Sepolia Etherscan.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
