export type TeamMember = {
  email: string;
  displayName: string;
  role: "manager" | "member";
  aliases?: string[];
};

export const teamRoster: TeamMember[] = [
  {
    email: "h.abusalem@gmail.com",
    displayName: "Haitham Abu Salem",
    role: "manager",
    aliases: ["haitham@eng-bim.com"],
  },
  {
    email: "a.salloum@eng-bim.com",
    displayName: "Ashraf Salloum",
    role: "manager",
  },
  {
    email: "a.alfarahneh@eng-bim.com",
    displayName: "Ahmad Al Farahneh",
    role: "member",
  },
  {
    email: "a.eneizat@eng-bim.com",
    displayName: "Ali Eneizat",
    role: "member",
  },
];

export function findTeamMember(email: string) {
  const normalized = email.trim().toLowerCase();
  return teamRoster.find(
    (member) =>
      member.email === normalized || member.aliases?.includes(normalized),
  );
}
