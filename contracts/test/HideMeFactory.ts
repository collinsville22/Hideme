import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { HideMeFactory, HideMeFactory__factory, HideMeToken, HideMeToken__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("HideMeFactory")) as HideMeFactory__factory;
  const hideMeFactory = (await factory.deploy()) as HideMeFactory;
  const factoryAddress = await hideMeFactory.getAddress();
  return { hideMeFactory, factoryAddress };
}

describe("HideMeFactory", function () {
  let signers: Signers;
  let hideMeFactory: HideMeFactory;
  let factoryAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    ({ hideMeFactory, factoryAddress } = await deployFixture());
  });

  describe("Token Creation", function () {
    it("should create a new token", async function () {
      const tx = await hideMeFactory
        .connect(signers.alice)
        .createToken("Alice Coin", "ALC", 1_000_000n, []);
      const receipt = await tx.wait();

      expect(await hideMeFactory.totalTokens()).to.equal(1);

      const allTokens = await hideMeFactory.getAllTokens();
      expect(allTokens.length).to.equal(1);

      const info = await hideMeFactory.tokenInfo(allTokens[0]);
      expect(info.name).to.equal("Alice Coin");
      expect(info.symbol).to.equal("ALC");
      expect(info.initialSupply).to.equal(1_000_000n);
      expect(info.creator).to.equal(signers.alice.address);
    });

    it("should create token with observers", async function () {
      await (
        await hideMeFactory
          .connect(signers.alice)
          .createToken("Secret Token", "SEC", 500_000n, [signers.bob.address])
      ).wait();

      const allTokens = await hideMeFactory.getAllTokens();
      const tokenAddr = allTokens[0];

      // Connect to the created token
      const token = HideMeToken__factory.connect(tokenAddr, signers.alice);
      expect(await token.isObserver(signers.bob.address)).to.equal(true);
    });

    it("should track tokens by creator", async function () {
      // Alice creates 2 tokens
      await (await hideMeFactory.connect(signers.alice).createToken("Token A", "TKA", 100n, [])).wait();
      await (await hideMeFactory.connect(signers.alice).createToken("Token B", "TKB", 200n, [])).wait();

      // Bob creates 1 token
      await (await hideMeFactory.connect(signers.bob).createToken("Token C", "TKC", 300n, [])).wait();

      const aliceTokens = await hideMeFactory.getTokensByCreator(signers.alice.address);
      expect(aliceTokens.length).to.equal(2);

      const bobTokens = await hideMeFactory.getTokensByCreator(signers.bob.address);
      expect(bobTokens.length).to.equal(1);

      expect(await hideMeFactory.totalTokens()).to.equal(3);
    });

    it("creator should have initial supply in created token", async function () {
      const supply = 1_000_000n;
      await (
        await hideMeFactory.connect(signers.alice).createToken("My Token", "MTK", supply, [])
      ).wait();

      const allTokens = await hideMeFactory.getAllTokens();
      const token = HideMeToken__factory.connect(allTokens[0], signers.alice);
      const tokenAddress = allTokens[0];

      const encBal = await token.balanceOf(signers.alice.address);
      const balance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encBal,
        tokenAddress,
        signers.alice,
      );
      expect(balance).to.equal(supply);
    });
  });

  describe("Pagination", function () {
    it("should return paginated results", async function () {
      // Create 5 tokens
      for (let i = 0; i < 5; i++) {
        await (
          await hideMeFactory
            .connect(signers.alice)
            .createToken(`Token ${i}`, `T${i}`, BigInt((i + 1) * 100), [])
        ).wait();
      }

      // Get first page (3 items)
      const page1 = await hideMeFactory.getTokensPaginated(0, 3);
      expect(page1.length).to.equal(3);
      expect(page1[0].name).to.equal("Token 0");
      expect(page1[2].name).to.equal("Token 2");

      // Get second page
      const page2 = await hideMeFactory.getTokensPaginated(3, 3);
      expect(page2.length).to.equal(2);
      expect(page2[0].name).to.equal("Token 3");
    });

    it("should return empty for out of range offset", async function () {
      const result = await hideMeFactory.getTokensPaginated(100, 10);
      expect(result.length).to.equal(0);
    });
  });
});
