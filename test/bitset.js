var claire = require('claire');

var forAll = claire.forAll,
    arb = claire.data,
    label = claire.label,
    choice = claire.choice,
    transform = claire.transform;

var BitSet = require('../lib/bitset').BitSet;
var PosInt = transform(Math.floor, arb.Positive);

var EmptyBitSet = label('bitset', transform(
  function(size) {
    return new BitSet(size);
  },
  choice(arb.Nothing, PosInt)));

module.exports.testBitSet = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    return b.get(bit);
  }).asTest();

module.exports.testClearBit = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    b.clear(bit);
    return !b.get(bit);
  }).asTest();

module.exports.nextSetOfEmpty = forAll(EmptyBitSet)
  .satisfy(function(b) {
    return b.nextSetBit(0) === -1;
  }).asTest();

module.exports.nextSetOfOneBit = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    return b.nextSetBit(0) === bit;
  }).asTest();

module.exports.nextSetSameBit = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    return b.nextSetBit(bit) === bit;
  }).asTest();

module.exports.nextSetFollowingBit = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    return b.nextSetBit(bit+1) === -1;
  }).asTest();

module.exports.nextClearOfEmpty = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) { return b.nextClearBit(bit) === bit; })
  .asTest();

module.exports.nextClearOfOneSet = forAll(EmptyBitSet, PosInt)
  .satisfy(function(b, bit) {
    b.set(bit);
    return b.nextClearBit(bit) === bit + 1;
  }).asTest();
