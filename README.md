# QRL Contracts

A library of Hyperion smart contracts for the QRL: token standards and the utilities they are built on. It is a port of [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) to Hyperion and the QRVM, where words and addresses are 64 bytes.

## Contents

| Path | What it provides |
| --- | --- |
| `token/SQRCTF1` | Fungible token (`SQRCTF1`) with name, symbol and decimals |
| `token/SQRCTN1` | Non-fungible token (`SQRCTN1`), with `SQRCTN1Enumerable` and `SQRCTN1URIStorage` extensions |
| `token/SQRCTB1` | Multi-token (`SQRCTB1`) with single and batch operations |
| `interfaces` | Standard interfaces and the custom errors the tokens revert with |
| `utils` | `Strings`, `Arrays`, `StorageSlot`, `SlotDerivation`, `Panic`, `Counters`, `Comparators`, `Context` |
| `utils/math` | `Math`, `SignedMath`, `SafeCast` |
| `utils/introspection` | `ZRC165` interface detection |

## Requirements

Hyperion 0.3.1 or later, either the native `hypc` or [`@theqrl/hypc`](https://www.npmjs.com/package/@theqrl/hypc) (`hypcjs`), which needs Node.js 22.12 or later. Earlier compilers use a different panic encoding than `utils/Panic.hyp` emits.

## Usage

```bash
npm install @theqrl/qrl-contracts
```

```hyperion
// SPDX-License-Identifier: MIT
pragma hyperion >=0.3.1;

import {SQRCTF1} from "@theqrl/qrl-contracts/token/SQRCTF1/SQRCTF1.hyp";

contract Gold is SQRCTF1 {
    constructor(uint256 initialSupply) SQRCTF1("Gold", "GLD") {
        _mint(msg.sender, initialSupply);
    }
}
```

Compile with the package directory on the include path:

```bash
hypcjs --base-path . --include-path node_modules --abi --bin -o build Gold.hyp
```

## Porting from Ethereum

Most contracts written against OpenZeppelin port by changing import paths and names. The differences that come from the 64-byte word size are listed in [MIGRATION-64-BYTE-WORDS.md](MIGRATION-64-BYTE-WORDS.md), including the two `Arrays.unsafeAccess` overloads that are not provided. Address formatting is covered in [MIGRATION-QIP55.md](MIGRATION-QIP55.md).

Inline assembly does not port unchanged. On the QRVM:

- a word is 64 bytes, and the free-memory pointer is at `0x80`;
- array and `bytes` data starts 64 bytes after the length;
- an `address` fills a whole word, and a `bytes32` sits in its upper half;
- a storage key is the low 256 bits of the slot.

## Development

The compiler is taken from `HYPC`, which defaults to `hypcjs`.

```bash
npm run compile
```

```bash
npm test
```

Two further suites run the contracts in `test/vm` on the legacy and IR pipelines. Each `test…()` function runs on a fresh deployment and passes if it does not revert.

In go-qrl's VM, which needs Go and a go-qrl checkout:

```bash
GO_QRL=/path/to/go-qrl npm run test:vm
```

In qrvmone through Hyperion's semantic test runner, which needs a native Hyperion build and takes a few minutes:

```bash
IHYPTEST=/path/to/hyperion/build/test/tools/ihyptest QRVMONE=/path/to/libqrvmone.dylib npm run test:hyptest
```

Both accept a filter as an argument and run the tests whose name contains it. `test:vm` names a test `<Contract>.<function>()`, for example `MathTest.testModExp()`; `test:hyptest` names it `<File>.<function>`, for example `Math.testModExp`. A function name works for both:

```bash
GO_QRL=/path/to/go-qrl npm run test:vm -- testModExp
```

## Releases

Releases are cut automatically from commits on `main`; commit messages follow Conventional Commits. See [RELEASE.md](RELEASE.md).

## License

[MIT](LICENSE). This library is derived from OpenZeppelin Contracts, which is also MIT licensed; its copyright notice is retained in the licence file.
