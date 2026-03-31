<p align="center">
  <img src="frontend/public/logo.png" alt="HideMe Logo" width="120" />
</p>

<h1 align="center">HideMe -- Confidential Token Infrastructure on Ethereum</h1>

<p align="center">
  <strong>Create, transfer, and pay with fully encrypted ERC-20 tokens. Balances and transfer amounts are invisible on-chain, powered by Fully Homomorphic Encryption (FHE) via Zama's fhEVM.</strong>
</p>

<p align="center">
  <code>Next.js 16</code> · <code>React 19</code> · <code>Solidity 0.8.27</code> · <code>Zama fhEVM</code> · <code>Wagmi 2</code> · <code>Tailwind CSS 4</code> · <code>Hardhat</code> · <code>TypeScript 5</code>
</p>

<p align="center">
  <a href="https://frontend-omega-flame-98.vercel.app"><strong>Live App</strong></a> · <a href="https://www.mintlify.com/collinsville22/Hideme"><strong>Documentation</strong></a> · <a href="https://youtu.be/W1IftDv2HY4"><strong>Demo Video</strong></a> · <a href="https://etherscan.io/address/0x46E16F6E248dfa735D50345b1d2657C8dBC5d60B"><strong>Factory on Etherscan</strong></a> · <a href="#on-chain-evidence"><strong>Mainnet Proof</strong></a>
</p>

---

<h2 align="center">Demo</h2>

<p align="center">
  <a href="https://youtu.be/W1IftDv2HY4">
    <img src="https://img.youtube.com/vi/W1IftDv2HY4/maxresdefault.jpg" alt="HideMe Demo Video" width="720" />
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/W1IftDv2HY4"><strong>Watch the full demo on YouTube</strong></a>
</p>

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Smart Contracts](#smart-contracts)
  - [HideMeToken](#1-hidemetoken)
  - [HideMeFactory](#2-hidemefactory)
  - [ConfidentialWrapper](#3-confidentialwrapper)
  - [WrapperFactory](#4-wrapperfactory)
  - [ConfidentialPaymentRouterV2](#5-confidentialpaymentrouterv2)
  - [ConfidentialPayments](#6-confidentialpayments)
- [Features](#features)
  - [Token Registry](#1-token-registry)
  - [Encrypted Transfers](#2-encrypted-transfers)
  - [Private Portfolio](#3-private-portfolio)
  - [Confidential Payments](#4-confidential-payments)
  - [Payment Links](#5-payment-links)
- [Contract Addresses (Mainnet)](#contract-addresses-mainnet)
- [On-Chain Evidence](#on-chain-evidence)
- [Directory Structure](#directory-structure)
- [Development Setup](#development-setup)
- [Security](#security)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 16)                     │
│                                                                   │
│   Registry    Portfolio    Payments    Token Detail    Create      │
│      │           │            │            │             │         │
│      └───────────┴────────────┴────────────┴─────────────┘        │
│                           │                                       │
│                     Wagmi / Viem                                   │
│                           │                                       │
│              ┌────────────┴────────────┐                          │
│              │   Zama Relayer SDK      │                          │
│              │   (TFHE WASM + KMS)     │                          │
│              └────────────┬────────────┘                          │
└───────────────────────────┼───────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────────┐
│  Ethereum L1    │ │  Zama KMS   │ │  Gateway Chain      │
│                 │ │  Network    │ │  (Decryption Proof)  │
│  HideMeFactory  │ │             │ │                     │
│  HideMeToken    │ │  Encrypts   │ │  Public Decrypt     │
│  WrapperFactory │ │  Decrypts   │ │  User Decrypt       │
│  Wrappers       │ │  Computes   │ │  Threshold Sigs     │
│  RouterV2       │ │             │ │                     │
│  Payments       │ │             │ │                     │
└─────────────────┘ └─────────────┘ └─────────────────────┘
```

HideMe operates across three layers:

1. **Ethereum Mainnet** stores encrypted balances as FHE ciphertexts. All arithmetic (add, subtract, compare) happens on encrypted data without decryption.

2. **Zama KMS Network** manages encryption keys and performs threshold decryption. Only the balance owner can request decryption via EIP-712 signature.

3. **Gateway Chain** coordinates public decryption requests for operations like unwrapping, where the result must be verified on-chain.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16 + React 19 | Server components, API routes, Turbopack |
| Styling | Tailwind CSS 4 | Dark theme with gold accent (#D4A843) |
| Wallet | Wagmi 2 + RainbowKit 2 | Wallet connection, contract interaction |
| Encryption | Zama fhEVM + TFHE | Fully Homomorphic Encryption on-chain |
| Contracts | Solidity 0.8.27 + Hardhat | FHE-enabled smart contracts |
| Chain | Ethereum Mainnet | Production deployment |
| RPC | PublicNode, DRPC, MEVBlocker | Fallback RPC configuration |

---

## Smart Contracts

### 1. HideMeToken

Native confidential ERC-20 with FHE-encrypted balances. Every token created through the registry deploys a new instance.

**Encryption model**: Balances stored as `euint64` (encrypted 64-bit unsigned integers). Transfer amounts encrypted via `FHE.asEuint64()`. Comparisons use `FHE.le()` with `FHE.select()` to prevent balance leakage through reverts.

```
MINT FLOW
  Owner calls mint(to, amount)
  → FHE.asEuint64(amount) encrypts on-chain
  → FHE.add(balance, encrypted) updates ciphertext
  → FHE.allow(newBalance, to) grants decrypt access

TRANSFER FLOW
  Sender calls transfer(to, encryptedAmount, proof)
  → FHE.fromExternal() verifies client-side encryption
  → FHE.le(amount, balance) checks sufficiency (encrypted)
  → FHE.select(canTransfer, amount, 0) prevents info leak
  → FHE.sub / FHE.add update both balances
  → Amount is 0 in event (privacy-preserving)
```

| Feature | Detail |
|---------|--------|
| Decimals | 6 (all tokens) |
| Transfer modes | Encrypted input, on-chain euint64, plaintext |
| Compliance | Observer addresses can decrypt any balance |
| Governance | Owner can mint (if mintable), add observers, renounce |
| Burn | Holder burns own tokens (if burnable) |

### 2. HideMeFactory

Deploys HideMeToken instances and stores on-chain metadata (name, symbol, supply, description, logo URI, website). Supports paginated querying for the frontend registry.

### 3. ConfidentialWrapper

Converts any standard ERC-20 into a confidential token. Wrapping locks the ERC-20 and mints an encrypted cToken balance. Unwrapping is a 2-step async process requiring KMS threshold decryption.

```
WRAP FLOW
  User approves wrapper → calls wrap(amount)
  → ERC-20 transferred to wrapper via safeTransferFrom
  → Decimal adjustment (e.g. 18 → 6 for WETH)
  → FHE.asEuint64(adjusted) creates encrypted balance
  → cToken balance updated

UNWRAP FLOW (2-step)
  Step 1: User calls unwrap(amount)
    → FHE.le(amount, balance) creates encrypted boolean
    → FHE.makePubliclyDecryptable(canUnwrap) requests KMS proof
    → Account restricted until finalization

  Step 2: Relayer calls finalizeUnwrap(requestId, proof)
    → FHE.checkSignatures() verifies KMS threshold signatures
    → If canUnwrap == true: burns cToken, transfers ERC-20 back
    → Restriction cleared
```

### 4. WrapperFactory

Deploys one ConfidentialWrapper per ERC-20 token. Enforces uniqueness and provides discovery for the frontend.

### 5. ConfidentialPaymentRouterV2

One-click confidential payments where the receiver gets plain ERC-20 without ever touching FHE. The router wraps, transfers encrypted, unwraps, and delivers in a single flow.

```
PAYMENT FLOW
  Sender: approve + send(token, receiver, amount, memo) + 0.00005 ETH fee
    → Router pulls ERC-20 from sender
    → Router wraps into cToken (encrypted)
    → Router requests unwrap (KMS decryption)
    → Payment record created

  Relayer: finalize(paymentId, kmsProof)
    → KMS proof submitted → wrapper finalizes unwrap
    → Plain ERC-20 forwarded to receiver
    → Relayer receives ETH fee for gas reimbursement
```

| Parameter | Value |
|-----------|-------|
| Min relayer fee | 0.00005 ETH |
| Cancel timeout | 1 day |
| Gas limit (send) | ~1,500,000 |

### 6. ConfidentialPayments

Payment links for HideMeToken (native confidential tokens). Merchants create payment links with fixed amounts; payers call `payLink()` which triggers `transferPlaintext` for on-chain encryption.

---

## Features

### 1. Token Registry

The home page displays all confidential tokens created through the factory. Users can create new tokens with configurable supply, mintability, burnability, max supply, observers, and metadata.

**Token creation parameters**:
- Name, symbol, initial supply
- Mintable (owner can create more)
- Burnable (holders can destroy)
- Max supply cap (0 = unlimited)
- Observer addresses (compliance/audit)
- Logo URI, website, description

### 2. Encrypted Transfers

Each token detail page provides encrypted transfer capability. The amount is encrypted client-side using TFHE WASM, submitted with an input proof, and verified on-chain via the InputVerifier contract. An alternative on-chain encryption mode (`transferPlaintext`) encrypts within the EVM for environments where client-side WASM is unavailable.

### 3. Private Portfolio

Scans the user's wallet for both public ERC-20 balances and encrypted cToken balances across all registered wrappers.

- **Make Private**: Wraps ERC-20 into encrypted cToken (single or batch)
- **Make Public**: Unwraps cToken back to plain ERC-20 (auto-finalized via relayer)
- **Decrypt All**: Single wallet signature reveals all encrypted balances

### 4. Confidential Payments

Send any ERC-20 confidentially. The sender's amount is encrypted on-chain; the receiver gets plain tokens delivered by the relayer. Supports single and batch payments.

**Batch payments** process sequentially (send → finalize → send → finalize) because the wrapper restricts the router during pending unwraps.

### 5. Payment Links

Merchants create payment links for HideMeToken with fixed amounts and optional expiry. Payers fulfill links through on-chain encrypted transfer.

---

## Contract Addresses (Mainnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| HideMeFactory | `0x46E16F6E248dfa735D50345b1d2657C8dBC5d60B` | [Etherscan](https://etherscan.io/address/0x46E16F6E248dfa735D50345b1d2657C8dBC5d60B) |
| WrapperFactory | `0xde8d3122329916968BA9c5E034Bbade431687408` | [Etherscan](https://etherscan.io/address/0xde8d3122329916968BA9c5E034Bbade431687408) |
| PaymentRouterV2 | `0x087D50Bb21a4C7A5E9394E9739809cB3AA6576Fa` | [Etherscan](https://etherscan.io/address/0x087D50Bb21a4C7A5E9394E9739809cB3AA6576Fa) |
| ConfidentialPayments | `0xA12c43CFCe337f0f8b831551Fbd273A61b0488d5` | [Etherscan](https://etherscan.io/address/0xA12c43CFCe337f0f8b831551Fbd273A61b0488d5) |
| WETH Wrapper (cWETH) | `0x7a339078f9abde76c7cf9360238eafd2a64c0ee7` | [Etherscan](https://etherscan.io/address/0x7a339078f9abde76c7cf9360238eafd2a64c0ee7) |
| USDC Wrapper (cUSDC) | `0x1704cd8697f1c4f21bab3e0c4cf149cb7b1e5147` | [Etherscan](https://etherscan.io/address/0x1704cd8697f1c4f21bab3e0c4cf149cb7b1e5147) |
| Example HideMeToken | `0x02FA7116A5653dfDFe51cF83F587CB80F560145d` | [Etherscan](https://etherscan.io/address/0x02FA7116A5653dfDFe51cF83F587CB80F560145d) |

---

## On-Chain Evidence

Every feature has been tested and verified on Ethereum mainnet.

### Token Creation

| Action | TX Hash | Explorer |
|--------|---------|----------|
| Deploy first HideMeToken | `0x499269c9...` | [TX](https://etherscan.io/tx/0x499269c9577226a1800308ca37751df9737610928d9524334d0233900c120d63) |
| Deploy second HideMeToken (10,000 supply) | `0x434481fc...` | [TX](https://etherscan.io/tx/0x434481fc84a1471456015dcc19a82c641d6588ceedc189edfb497d16e427d779) |

### Encrypted Transfers (HideMeToken)

| Action | TX Hash | Explorer |
|--------|---------|----------|
| Mint 10,000 tokens to creator | `0x434481fc...` | [TX](https://etherscan.io/tx/0x434481fc84a1471456015dcc19a82c641d6588ceedc189edfb497d16e427d779) |
| Encrypted transfer (client-side FHE) | `0xc08e13cf...` | [TX](https://etherscan.io/tx/0xc08e13cf3a8a55dc5946304ebd847ea45ed6381b29581a6fd8b7f2fde75cb268) |
| On-chain encrypted transfer (transferPlaintext) | `0xb83621cc...` | [TX](https://etherscan.io/tx/0xb83621cca2022e47b887b24a258f080b60b3970354505d3d003e356eb0dc662e) |
| Burn tokens | `0xc1a881d0...` | [TX](https://etherscan.io/tx/0xc1a881d0d11100dbe0447ae2f4b6854b435d32e7971b7196533e46889f7dce5a) |

### ERC-20 Wrapping

| Action | TX Hash | Explorer |
|--------|---------|----------|
| Create WETH wrapper (cWETH) | `0xc38c604f...` | [TX](https://etherscan.io/tx/0xc38c604f6acd2808eabf89802da659e1c4d57d8ede09aec491fa0e2d15267ec4) |
| Create USDC wrapper (cUSDC) | `0xa4b55626...` | [TX](https://etherscan.io/tx/0xa4b556264dc8ce0fdc29f25971a57854ec6550b39f31c65513752cc4d8da9249) |
| Wrap WETH into cWETH | `0x6f2054f8...` | [TX](https://etherscan.io/tx/0x6f2054f89dcef5ed90a0741b0a545eaf91bf700cb9c4c21a412c16e9f658675b) |
| Wrap USDC into cUSDC | `0x6ab64742...` | [TX](https://etherscan.io/tx/0x6ab647427e8630d707a008d71b05792437a4c0fa81f84c91430d6653a7e656fd) |
| Unwrap cWETH (finalize) | `0x151f9782...` | [TX](https://etherscan.io/tx/0x151f97820f0e892b577beea4ae75e5c04c260b17497df600f2afb97dd0dfad38) |
| Unwrap cUSDC (finalize) | `0xdf8f02fd...` | [TX](https://etherscan.io/tx/0xdf8f02fdc544f7c43af5bb315279494c9dd46198dfdb67e1c7184097c1799607) |

### Confidential Payments (RouterV2)

12 payments sent and finalized on mainnet:

| Payment | Send TX | Finalize TX |
|---------|---------|-------------|
| #0 | [TX](https://etherscan.io/tx/0x6f2054f89dcef5ed90a0741b0a545eaf91bf700cb9c4c21a412c16e9f658675b) | [TX](https://etherscan.io/tx/0xe37da27eaab0e27516bd41f74863bfc09c75ddc8c1a698f5e81ae529e504c5f6) |
| #1 | [TX](https://etherscan.io/tx/0x8a301f0752a3737ae020f079008d47fd49db1347d916ff3faac2836b2052cd95) | [TX](https://etherscan.io/tx/0xa7057e2b4b67819703bcb8ebddbcf997120d2acfea85e8dcd0852941e4471a26) |
| #2 | [TX](https://etherscan.io/tx/0x76905236e69fce040279e6e0631d5c37f73fadf191920207ae2c11bc49353792) | [TX](https://etherscan.io/tx/0x8461c773f66da0f0979c1b7dd3bc82b78974af1a6761f470591b6aba59918e36) |
| #3 | [TX](https://etherscan.io/tx/0x7c7fb39233c21aa29180ac25e4ef37cb2f9227051ea76fecb14dbdcee00fc934) | [TX](https://etherscan.io/tx/0x8de617ec963875b1f9cce139945e4452db6f6de7dc8ac70c861307dc0b273519) |
| #4 | [TX](https://etherscan.io/tx/0xdede5c8451ab224476ba2730cb1fafdf7648cf01a4b2573cc04e7131f1219923) | [TX](https://etherscan.io/tx/0x2324804108a661c07b64739d17063019e5558c582cfe7bcc297e880a97ea097b) |
| #5 | [TX](https://etherscan.io/tx/0xa12316015c1acfff1304a11e05baacce71d209719a838690ae5760a7f19ef0f5) | [TX](https://etherscan.io/tx/0xd463080b0b6166c95730130f9c7a58cb0a6a74334f875bbd1baf0021dd036cd9) |
| #6 | [TX](https://etherscan.io/tx/0xbc4a6f5a8f7da1204e74ce06ce3f5a22570730d615288006c5d6924a0a17f9d8) | [TX](https://etherscan.io/tx/0x423c31423094dc667ded73b3480d9925a1aea578107f2f57e7822f08c66658dd) |
| #7 | [TX](https://etherscan.io/tx/0x1aa3d7a85474f097aad57748001198f0e5ffc7743d811b5480ebe67ac85e4d30) | [TX](https://etherscan.io/tx/0xdf476664cfe1ee385c3572aea761774ac3531ee9bc26aab82f43ae50a3f89f40) |
| #8 | [TX](https://etherscan.io/tx/0x01e4a0d3b15ba667e821379bd6a4578b2363ecbc1a78d59afa8493b3dbf17236) | [TX](https://etherscan.io/tx/0x6501c1ba72c20e0dbee77fbe4416d2f3052255ec24d6875213f0b18356236805) |
| #9 | [TX](https://etherscan.io/tx/0x90c68e2ea4bcc197e9b7e659e70474744645bcbb5c0afbc8df71fa51cf29127d) | [TX](https://etherscan.io/tx/0x4706c2ab46e1c51e494f053b0f189d33a596d9b8acebb4f5df9c510eeb2f8353) |
| #10 | [TX](https://etherscan.io/tx/0xc878c1ff9d9a0242290409a485f64ae8ba62f8dfaa03f513485b25c2c215d457) | [TX](https://etherscan.io/tx/0xe593bb10f1516f84651fdecf59edab9044bb5424c766b61a8a63b7bebc4f1d61) |
| #11 | [TX](https://etherscan.io/tx/0xfa69a815da28d89626c3103523118f6c530bd9e4c21a6de2c4c27bfc9be7843c) | [TX](https://etherscan.io/tx/0x4de9b72cbc2274b7c03c9e9ffd0de6e1e4010a478dbf3ffabdc92df146b072a7) |

---

## Directory Structure

```
hideme/
├── contracts/
│   ├── contracts/
│   │   ├── HideMeToken.sol              # Core confidential ERC-20
│   │   ├── HideMeFactory.sol            # Token deployment factory
│   │   ├── ConfidentialWrapper.sol       # ERC-20 → encrypted cToken
│   │   ├── WrapperFactory.sol           # Wrapper deployment factory
│   │   ├── ConfidentialPaymentRouterV2.sol  # Encrypted payment router
│   │   └── ConfidentialPayments.sol     # Payment links
│   ├── deploy/
│   │   ├── deployHideMe.ts             # Factory deployment
│   │   ├── deployPayments.ts           # Payments deployment
│   │   ├── deployRouterV2.ts           # Router deployment
│   │   └── deployWrapperFactory.ts     # Wrapper factory deployment
│   ├── hardhat.config.ts
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                 # Token registry (home)
│   │   │   ├── create/page.tsx          # Token creation wizard
│   │   │   ├── token/[address]/page.tsx # Token detail + controls
│   │   │   ├── portfolio/page.tsx       # Private portfolio management
│   │   │   ├── payments/page.tsx        # Confidential payments
│   │   │   └── api/
│   │   │       ├── decrypt/v1/user-decrypt/route.ts  # Mini-relayer
│   │   │       ├── payments/finalize/route.ts        # Payment finalization
│   │   │       └── unwrap/finalize/route.ts          # Unwrap finalization
│   │   ├── components/
│   │   │   ├── CreateTokenForm.tsx      # Multi-step token creation
│   │   │   ├── Header.tsx               # Navigation + network indicator
│   │   │   ├── Providers.tsx            # Wagmi + RainbowKit + React Query
│   │   │   ├── TokenCard.tsx            # Registry token display
│   │   │   └── TokenDetail.tsx          # Token control panel
│   │   └── lib/
│   │       ├── constants.ts             # Addresses, Zama config, helpers
│   │       ├── fhevm.ts                 # FHE SDK loader + encrypt/decrypt
│   │       ├── wagmi.ts                 # Chain + RPC configuration
│   │       └── abi/                     # Contract ABIs (7 files)
│   ├── public/
│   │   ├── logo.png                     # Project logo
│   │   └── sdk/                         # Zama TFHE WASM bundles
│   ├── next.config.ts
│   └── package.json
│
└── README.md
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm or npm
- A wallet with ETH on Ethereum mainnet (for deployment)

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # Configure addresses and relayer key
npm run dev                         # Starts on http://localhost:3000
```

### Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat deploy --network mainnet --tags HideMeFactory
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_FACTORY_ADDRESS_MAINNET` | HideMeFactory address |
| `NEXT_PUBLIC_NETWORK` | `mainnet` or `sepolia` |
| `GATEWAY_RELAYER_PRIVATE_KEY` | Relayer wallet key (for KMS transactions) |

---

## Security

**Privacy guarantees**:
- Balances stored as FHE ciphertexts (euint64) on Ethereum L1
- Transfer amounts encrypted; events emit 0 to prevent leakage
- Only the account owner (+ designated observers) can decrypt their balance
- Insufficient balance transfers silently send 0 instead of reverting (prevents balance probing)

**Trust assumptions**:
- Zama KMS threshold network for key management and decryption
- Gateway chain for coordinating public decryption requests
- Relayer wallet for submitting finalization transactions (non-custodial; anyone can finalize)

**Design decisions**:
- No pausable or blacklist mechanisms (maximizes decentralization)
- Observer model provides compliance without compromising holder privacy
- 1-day timeout on unwrap/cancel prevents permanent lock-up
- Silent failures on encrypted comparisons are intentional (FHE standard pattern)
