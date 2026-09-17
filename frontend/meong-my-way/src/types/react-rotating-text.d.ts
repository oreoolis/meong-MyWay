/**
 * `react-rotating-text` ships no types.
 *
 * Only the props used by `AgentThoughts` are declared. It is a plain
 * `React.Component` subclass using `componentDidMount`/`componentWillUnmount`
 * only, so it is safe on React 19 — but it reads `items` once, on mount, and
 * has no update path. Callers must remount it with a `key` when the list
 * changes.
 */
declare module "react-rotating-text" {
  import type { Component } from "react";

  export type ReactRotatingTextProps = {
    items: string[];
    /** ms per typed character. */
    typingInterval?: number;
    /** ms per deleted character. */
    deletingInterval?: number;
    /** ms to hold a finished line before deleting it. */
    pause?: number;
    /** ms before the first character is typed. */
    emptyPause?: number;
    color?: string;
    cursor?: boolean;
    className?: string;
  };

  export default class ReactRotatingText extends Component<ReactRotatingTextProps> {}
}
