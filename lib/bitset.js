//
//
//

// A bitset implementation, after that in java.util.  Yes there
// already exist such things, but none implement next{Clear|Set}Bit or
// equivalent, and none involved me tooling about for an evening.

'use strict';

function BitSet(size) {
  if (size) {
    var numWords = Math.ceil(size / 32);
    this.words = new Array(numWords);
  }
  else {
    this.words = [];
  }
  this.wordsInUse = 0; // = number, not index
}

var P = BitSet.prototype;

function wordIndex(bitIndex) {
  return Math.floor(bitIndex / 32);
}

// Make sure we have at least numWords
P.ensureSize = function(numWords) {
  var wordsPresent = this.words.length;
  if (wordsPresent < numWords) {
    this.words = this.words.concat(new Array(numWords - wordsPresent));
  }
}

P.set = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) {
    this.ensureSize(w + 1);
    this.wordsInUse = w + 1;
  }
  var bit = 1 << bitIndex;
  this.words[w] |= bit;
};

P.clear = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) return;
  var mask = ~(1 << bitIndex);
  this.words[w] &= mask;
};

P.get = function(bitIndex) {
  var w = wordIndex(bitIndex);
  if (w >= this.wordsInUse) return false; // >= since index vs size
  var bit = 1 << bitIndex;
  return !!(this.words[w] & bit);
}

function trailingZeros(i) {
  // From Hacker's Delight, via JDK. Probably far less effective here,
  // since bit ops are not necessarily the quick way to do things in
  // JS.
  if (i === 0) return 32;
  var y, n = 31;
  y = i << 16; if (y != 0) { n = n -16; i = y; }
  y = i << 8;  if (y != 0) { n = n - 8; i = y; }
  y = i << 4;  if (y != 0) { n = n - 4; i = y; }
  y = i << 2;  if (y != 0) { n = n - 2; i = y; }
  return n - ((i << 1) >>> 31);
}

// Give the next bit that's set on or after fromIndex, or -1 if no such
// bit
P.nextSetBit = function(fromIndex) {
  var w = wordIndex(fromIndex);
  if (w >= this.wordsInUse) return -1;

  // the right-hand side is shifted to only test the bits of the first
  // word that are > fromIndex
  var word = this.words[w] & (0xffffffff << fromIndex);
  while (true) {
    if (word) return (w * 32) + trailingZeros(word);
    w++;
    if (w === this.wordsInUse) return -1;
    word = this.words[w];
  }
};

P.nextClearBit = function(fromIndex) {
  var w = wordIndex(fromIndex);
  if (w >= this.wordsInUse) return fromIndex;

  var word = ~(this.words[w]) & (0xffffffff << fromIndex);
  while (true) {
    if (word) return (w * 32) + trailingZeros(word);
    w++;
    if (w == this.wordsInUse) return w * 32;
    word = ~(this.words[w]);
  }
};

module.exports.BitSet = BitSet;
