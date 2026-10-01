'use client';

/**
 * The emoji the picker offers.
 *
 * A fixed list rather than the full Unicode range, for two reasons: a full picker
 * is thousands of glyphs with search and categories, which is a week's work and
 * most of it invisible in a demo, and a short list is what people actually reach
 * for. Reaction emoji also stay short -- the database column is capped at 16
 * characters, so anything longer would fail at the server with a message that
 * explains nothing.
 */
const EMOJI = [
  '👍', '👎', '🎉', '👍🏽', '❤️', '😂', '😅', '🙌',
  '🔥', '✅', '👀', '💯', '🤔', '🙏', '👏', '🚀',
  '😀', '😍', '😢', '😮', '🤝', '💡', '⭐', '⚡',
];

type Props = {
  onPick: (emoji: string) => void;
  /** The caller's own reactions, so a picked emoji toggles off if already given. */
  mine: Set<string>;
  onClose: () => void;
};

/**
 * A small emoji popover.
 *
 * Closes on outside click and on Escape. Both are here because the alternative is
 * a picker that stays open after the user has finished with it, and there is no
 * "click away" affordance without them.
 */
export function EmojiPicker({ onPick, mine, onClose }: Props) {
  return (
    <>
      {/* The scrim is a button so it is keyboard-reachable, and so a click
          anywhere else closes the popover rather than passing through to the
          message underneath. */}
      <button
        type="button"
        className="emoji-scrim"
        aria-label="Close reactions"
        onClick={onClose}
      />
      <div className="emoji-popover" role="menu" aria-label="Add a reaction">
        {EMOJI.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="menuitemradio"
            aria-checked={mine.has(emoji)}
            aria-label={`React with ${emoji}`}
            className={mine.has(emoji) ? 'emoji-option active' : 'emoji-option'}
            // `key` is stable and the emoji is a constant, so no untrusted string
            // reaches the DOM here.
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
