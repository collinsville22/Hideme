import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("hideme:info").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;
  const factory = await deployments.get("HideMeFactory");
  const contract = await hre.ethers.getContractAt("HideMeFactory", factory.address);
  const totalTokens = await contract.totalTokens();
});
