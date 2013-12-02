'use strict';

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

suite('BitSet', function() {

test('get bit', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       return b.get(bit);
     }).asTest());
  
test('clear bit', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       b.clear(bit);
       return !b.get(bit);
     }).asTest());

test('next set of empty', forAll(EmptyBitSet)
     .satisfy(function(b) {
       return b.nextSetBit(0) === -1;
     }).asTest());

test('next set of one bit', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       return b.nextSetBit(0) === bit;
     }).asTest());

test('next set same bit', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       return b.nextSetBit(bit) === bit;
     }).asTest());

test('next set following bit', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       return b.nextSetBit(bit+1) === -1;
     }).asTest());

test('next clear of empty', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) { return b.nextClearBit(bit) === bit; })
     .asTest());

test('next clear of one set', forAll(EmptyBitSet, PosInt)
     .satisfy(function(b, bit) {
       b.set(bit);
       return b.nextClearBit(bit) === bit + 1;
     }).asTest());

});
