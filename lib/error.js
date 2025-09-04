import { inherits } from 'node:util'

function trimStack(stack, num) {
  return stack && stack.split('\n').slice(num).join('\n');
}

export function IllegalOperationError(msg, stack) {
  var tmp = new Error();
  this.message = msg;
  this.stack = this.toString() + '\n' + trimStack(tmp.stack, 2);
  this.stackAtStateChange = stack;
}
inherits(IllegalOperationError, Error);

IllegalOperationError.prototype.name = 'IllegalOperationError';

export function stackCapture(reason) {
  var e = new Error();
  return 'Stack capture: ' + reason + '\n' +
    trimStack(e.stack, 2);
}

