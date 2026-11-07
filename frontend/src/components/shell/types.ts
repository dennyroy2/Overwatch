// Shell-level view types. The real values come from the store in step 8; until then the
// shell renders its empty states from defaults.
export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'not_found'

export const connectionLabel: Record<ConnectionState, string> = {
  idle: 'No case',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  not_found: 'Case not found',
}
