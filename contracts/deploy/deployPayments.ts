import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed = await deploy("ConfidentialPayments", {
    from: deployer,
    log: true,
  });

};

export default func;
func.id = "deploy_confidential_payments";
func.tags = ["ConfidentialPayments"];
