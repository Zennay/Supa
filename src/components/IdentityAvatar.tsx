/**
 * Prototype identity indicator, not a profile action.
 *
 * Replaces the misleading focusable profile button without creating a
 * destination, settings screen or account feature that does not exist.
 * The existing .avatar styles work for a non-interactive inline element.
 */
export function IdentityAvatar() {
  return (
    <span
      className="avatar"
      role="img"
      aria-label="Demo-avatar"
      data-profile-action="none"
    >
      ZE
    </span>
  )
}
