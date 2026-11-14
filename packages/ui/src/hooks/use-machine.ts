import { useCallback, useRef, useState } from "react";

/**
 * Holds one state that only `transition` moves. `send` applies an event at once and tells whether
 * the state took it: `transition` returns `undefined` for an event the current state does not
 * accept, so a refused event is also the guard against a second click or a late callback.
 */
export function useMachine<State, Event>(transition: (state: State, event: Event) => State | undefined, initial: State) {
  const [state, setState] = useState(initial);
  const current = useRef(initial);
  const send = useCallback((event: Event) => {
    const next = transition(current.current, event);
    if (next === undefined) return false;
    current.current = next;
    setState(next);
    return true;
  }, [transition]);
  return [state, send] as const;
}
