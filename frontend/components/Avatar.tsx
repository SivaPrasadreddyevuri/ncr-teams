type AvatarSize = 'sm' | 'md' | 'lg';

export function Avatar({
  initials,
  size = 'md',
  online = false,
}: {
  initials: string;
  size?: AvatarSize;
  online?: boolean;
}) {
  return (
    <span className={`avatar avatar-${size}`}>
      {initials}
      <i className={online ? 'online' : ''} />
    </span>
  );
}
