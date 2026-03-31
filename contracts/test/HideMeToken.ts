import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { HideMeToken, HideMeToken__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  observer: HardhatEthersSigner;
};

const INITIAL_SUPPLY = 1_000_000n; // 1M tokens (6 decimals = 1 token)

async function deployFixture(signers: Signers) {
  const factory = (await ethers.getContractFactory("HideMeToken")) as HideMeToken__factory;
  const token = (await factory.deploy(
    "HideMe USD",
    "hmUSD",
    INITIAL_SUPPLY,
    signers.deployer.address,
    [signers.observer.address],
  )) as HideMeToken;
  const tokenAddress = await token.getAddress();
  return { token, tokenAddress };
}

describe("HideMeToken", function () {
  let signers: Signers;
  let token: HideMeToken;
  let tokenAddress: string;

  before(async function () {
    const ethSigners = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      observer: ethSigners[3],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    ({ token, tokenAddress } = await deployFixture(signers));
  });

  describe("Deployment", function () {
    it("should set name and symbol", async function () {
      expect(await token.name()).to.equal("HideMe USD");
      expect(await token.symbol()).to.equal("hmUSD");
    });

    it("should set total supply", async function () {
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("should set owner", async function () {
      expect(await token.owner()).to.equal(signers.deployer.address);
    });

    it("should register observer", async function () {
      expect(await token.isObserver(signers.observer.address)).to.equal(true);
      const observers = await token.getObservers();
      expect(observers.length).to.equal(1);
      expect(observers[0]).to.equal(signers.observer.address);
    });

    it("should mint initial supply to owner", async function () {
      const encryptedBalance = await token.balanceOf(signers.deployer.address);
      const balance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBalance,
        tokenAddress,
        signers.deployer,
      );
      expect(balance).to.equal(INITIAL_SUPPLY);
    });
  });

  describe("Transfer", function () {
    it("should transfer tokens with encrypted amount", async function () {
      const transferAmount = 100_000n;

      // Encrypt the transfer amount
      const encrypted = await fhevm
        .createEncryptedInput(tokenAddress, signers.deployer.address)
        .add64(transferAmount)
        .encrypt();

      // Transfer from deployer to alice
      const tx = await token
        .connect(signers.deployer)
        ["transfer(address,bytes32,bytes)"](
          signers.alice.address,
          encrypted.handles[0],
          encrypted.inputProof,
        );
      await tx.wait();

      // Check alice balance
      const aliceEncBal = await token.balanceOf(signers.alice.address);
      const aliceBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceEncBal,
        tokenAddress,
        signers.alice,
      );
      expect(aliceBal).to.equal(transferAmount);

      // Check deployer balance decreased
      const deployerEncBal = await token.balanceOf(signers.deployer.address);
      const deployerBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        deployerEncBal,
        tokenAddress,
        signers.deployer,
      );
      expect(deployerBal).to.equal(INITIAL_SUPPLY - transferAmount);
    });

    it("should not transfer more than balance (silent fail)", async function () {
      const tooMuch = INITIAL_SUPPLY + 1n;

      const encrypted = await fhevm
        .createEncryptedInput(tokenAddress, signers.deployer.address)
        .add64(tooMuch)
        .encrypt();

      const tx = await token
        .connect(signers.deployer)
        ["transfer(address,bytes32,bytes)"](
          signers.alice.address,
          encrypted.handles[0],
          encrypted.inputProof,
        );
      await tx.wait();

      // Alice should have 0 (transfer was a no-op, select chose 0)
      const aliceEncBal = await token.balanceOf(signers.alice.address);
      const aliceBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceEncBal,
        tokenAddress,
        signers.alice,
      );
      expect(aliceBal).to.equal(0n);

      // Deployer balance should remain unchanged
      const deployerEncBal = await token.balanceOf(signers.deployer.address);
      const deployerBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        deployerEncBal,
        tokenAddress,
        signers.deployer,
      );
      expect(deployerBal).to.equal(INITIAL_SUPPLY);
    });
  });

  describe("Mint", function () {
    it("should allow owner to mint", async function () {
      const mintAmount = 500_000n;
      const tx = await token.connect(signers.deployer).mint(signers.alice.address, mintAmount);
      await tx.wait();

      const aliceEncBal = await token.balanceOf(signers.alice.address);
      const aliceBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        aliceEncBal,
        tokenAddress,
        signers.alice,
      );
      expect(aliceBal).to.equal(mintAmount);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY + mintAmount);
    });

    it("should revert if non-owner tries to mint", async function () {
      await expect(
        token.connect(signers.alice).mint(signers.alice.address, 100n),
      ).to.be.revertedWithCustomError(token, "OnlyOwner");
    });
  });

  describe("Approve & TransferFrom", function () {
    it("should approve and transferFrom with encrypted amounts", async function () {
      const approveAmount = 200_000n;
      const transferAmount = 150_000n;

      // Deployer approves alice
      const encApprove = await fhevm
        .createEncryptedInput(tokenAddress, signers.deployer.address)
        .add64(approveAmount)
        .encrypt();

      await (
        await token
          .connect(signers.deployer)
          .approve(signers.alice.address, encApprove.handles[0], encApprove.inputProof)
      ).wait();

      // Alice transfers from deployer to bob
      const encTransfer = await fhevm
        .createEncryptedInput(tokenAddress, signers.alice.address)
        .add64(transferAmount)
        .encrypt();

      await (
        await token
          .connect(signers.alice)
          .transferFrom(
            signers.deployer.address,
            signers.bob.address,
            encTransfer.handles[0],
            encTransfer.inputProof,
          )
      ).wait();

      // Bob should have transferAmount
      const bobEncBal = await token.balanceOf(signers.bob.address);
      const bobBal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        bobEncBal,
        tokenAddress,
        signers.bob,
      );
      expect(bobBal).to.equal(transferAmount);
    });
  });

  describe("Observer (Compliance)", function () {
    it("observer can decrypt any balance", async function () {
      // Observer should be able to decrypt deployer's balance
      const deployerEncBal = await token.balanceOf(signers.deployer.address);
      const balance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        deployerEncBal,
        tokenAddress,
        signers.observer,
      );
      expect(balance).to.equal(INITIAL_SUPPLY);
    });

    it("owner can add observer", async function () {
      await (await token.connect(signers.deployer).addObserver(signers.bob.address)).wait();
      expect(await token.isObserver(signers.bob.address)).to.equal(true);
    });

    it("owner can remove observer", async function () {
      await (await token.connect(signers.deployer).removeObserver(signers.observer.address)).wait();
      expect(await token.isObserver(signers.observer.address)).to.equal(false);
    });

    it("non-owner cannot add observer", async function () {
      await expect(
        token.connect(signers.alice).addObserver(signers.bob.address),
      ).to.be.revertedWithCustomError(token, "OnlyOwner");
    });
  });
});
