# 64-byte word layout

Hyperion and the QRVM use 64-byte words. The library's inline assembly follows that layout, and a few APIs differ from their Ethereum counterparts as a result. This note is for anyone porting code that was written against the 32-byte versions.

## Removed: `Arrays.unsafeAccess` for `uint256[]` and `bytes32[]` storage arrays

`Arrays.unsafeAccess(uint256[] storage, uint256)` and `Arrays.unsafeAccess(bytes32[] storage, uint256)` are not provided.

Hyperion stores two 32-byte elements in each storage slot. These functions returned a `StorageSlot.Uint256Slot` or `StorageSlot.Bytes32Slot` pointer, and a storage pointer can only address the element in the lower half of a slot, so no implementation can return the right location for every index.

Decision (2026-11-16): keep them removed rather than replace them with functions that return the value. A replacement would not be source-compatible with `arr.unsafeAccess(i).value` either, would cover reads only, and would add API that differs from the original under the same name. Code that used these overloads fails to compile and should use `arr[i]`.

If unchecked access to packed arrays is needed later, add it under explicit names such as `unsafeRead` and `unsafeWrite`; do not reuse `unsafeAccess`.

Unaffected: `unsafeAccess` for `address[]`, `bytes[]` and `string[]` storage arrays (one element per slot), every `unsafeMemoryAccess` overload, `unsafeSetLength`, and the sorted-array searches (`lowerBound`, `upperBound`, `findUpperBound`), which read packed elements internally.

## Storage slots as `bytes32`

A storage key is 256 bits wide. `StorageSlot` and `SlotDerivation` take and return that key as a `bytes32`, so `bytes32(uint256(n))` is slot `n`. Derived slots match the compiler's layout for mappings and dynamic arrays, where keys and slot numbers are hashed as 64-byte words.

`SlotDerivation.offset(slot, pos)` moves by whole slots. For an array of 32-byte elements, slot `pos` holds elements `2 * pos` and `2 * pos + 1`.

## Math

`Math.mul512` and `Math.add512` still return the result as two 256-bit halves. `Math.mulDiv` reverts with `Panic(uint512)` code `0x12` for a zero denominator and `0x11` when the result does not fit in 256 bits.

## Panic

`Panic.panic(code)` reverts with the same data as a compiler-generated panic: selector `0xdf75fb3b` (`Panic(uint512)`) followed by the code as one 64-byte word.

## Tests

`npm run test:vm` runs `test/vm/*.t.hyp` in go-qrl's VM and `npm run test:hyptest` runs them as Hyperion semantic tests in qrvmone, each on the legacy and IR pipelines. See the header of `scripts/test-vm.js` and `scripts/test-hyptest.js` for the environment variables they need.
