export type AvatarSize = 'sm' | 'md' | 'lg';

export function Avatar({
  initials,
  src,
  size = 'md',
  online = false,
}: {
  initials: string;
  /**
   * Optional. When absent the initials render as before, which is what every
   * colleague avatar does -- only the signed-in user can have a photo.
   */
  src?: string;
  size?: AvatarSize;
  online?: boolean;
}) {
  return (
    <span className={`avatar avatar-${size}`}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <>
          {initials}
          <i className={online ? 'online' : ''} />
        </>
      )}
    </span>
  );
}
