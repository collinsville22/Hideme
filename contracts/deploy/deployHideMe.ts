import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFactory = await deploy("HideMeFactory", {
    from: deployer,
    log: true,
  });

};

export default func;
func.id = "deploy_hideme_factory";
func.tags = ["HideMeFactory"];
