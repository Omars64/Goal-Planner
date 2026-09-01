import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function ProfileAvatar({
  name,
  image,
  className = "",
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <Avatar className={`profile-avatar ${className}`.trim()}>
      {image ? <AvatarImage src={image} alt={`${name}'s profile picture`} /> : null}
      <AvatarFallback>{initials || "U"}</AvatarFallback>
    </Avatar>
  );
}
