import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const WRAPPER_FACTORY = "0xde8d3122329916968BA9c5E034Bbade431687408";

  const deployed = await deploy("ConfidentialPaymentRouterV2", {
    from: deployer,
    args: [WRAPPER_FACTORY],
    log: true,
  });

};

export default func;
func.id = "deploy_router_v2";
func.tags = ["RouterV2"];
