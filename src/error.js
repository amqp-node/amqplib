function trimStack(stack, num) {
  return stack && stack.split('\n').slice(num).join('\n')
}

export class IllegalOperationError extends Error {
  constructor(msg, stackAtStateChange) {
    super(msg)
    this.name = 'IllegalOperationError'

    const tmpStack = new Error().stack
    this.stack = `${this.toString()}\n${trimStack(tmpStack, 2)}`

    this.stackAtStateChange = stackAtStateChange
  }
}

export function stackCapture(reason) {
  const e = new Error()
  return 'Stack capture: ' + reason + '\n' + trimStack(e.stack, 2)
}
