// Compile-time proof that StreamMessage narrows on `type` and stays exhaustive.
// If a message type is added to the contract and not handled here, typecheck fails.
import type { StreamMessage } from './index'

export function describe(msg: StreamMessage): string {
  switch (msg.type) {
    case 'ghosts':
      return `${msg.data.positions.length} ghosts`
    case 'evidence':
      return msg.data.summary
    case 'tasking':
      return msg.data.asset
    case 'log':
      return msg.data.detail
    case 'found':
      return msg.data.note ?? 'found'
    default: {
      const unreachable: never = msg
      return unreachable
    }
  }
}
