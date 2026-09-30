const ADMINISTRATOR_PERMISSION = 8n;

export function isAdministrator(member) {
  return (
    member?.permissions !== undefined &&
    (BigInt(member.permissions) & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION
  );
}

export function isPublicCommand(commandName) {
  return commandName === 'kuchen';
}

export function canExecuteCommand(commandName, member) {
  return isPublicCommand(commandName) || isAdministrator(member);
}
