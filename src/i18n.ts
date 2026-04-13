export type SupportedLocale = "en" | "es" | "pt";

export type TelegramCommand = {
  command: string;
  description: string;
};

export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "es", "pt"];

function canonicalizeLanguageTag(languageCode?: string): string | undefined {
  if (!languageCode) return undefined;
  const trimmed = languageCode.trim().replace(/_/g, "-");
  if (!trimmed) return undefined;
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    return canonical;
  } catch {
    return undefined;
  }
}

export function normalizeSupportedLocale(languageCode?: string): SupportedLocale | undefined {
  const canonical = canonicalizeLanguageTag(languageCode);
  if (!canonical) return undefined;
  const base = canonical.toLowerCase().split("-")[0];
  if (base === "en" || base === "es" || base === "pt") return base;
  return undefined;
}

export function resolveSupportedLocale(
  preferredLanguage?: string,
  telegramLanguageCode?: string
): SupportedLocale {
  return normalizeSupportedLocale(preferredLanguage) ?? normalizeSupportedLocale(telegramLanguageCode) ?? "en";
}

type LocaleBundle = {
  commands: { member: TelegramCommand[]; admin: TelegramCommand[] };
  texts: {
    startWelcome: string;
    startAuthorizedHint: string;
    startUnauthorizedHint: string;
    openCommands: string;
    requestAccess: string;
    joinRequestTitle: string;
    joinRequestNameLabel: string;
    joinRequestUsernameLabel: string;
    joinRequestUserIdLabel: string;
    joinApprove: string;
    joinDeny: string;
    needJoin: string;
    alreadyMember: string;
    joinRequested: string;
    pendingRequest: string;
    notRecognized: string;
    onlyAdminsApprove: string;
    noPendingToApprove: string;
    multiplePendingToApprove: (count: number) => string;
    welcomeApproved: string;
    approvedUser: (name: string) => string;
    approvedUserId: (userId: number) => string;
    userAdded: (userId: number) => string;
    alreadyMemberId: (userId: number) => string;
    onlyAdminsRemove: string;
    removeUsage: string;
    removedUser: (userId: number) => string;
    couldNotRemoveUser: (userId: number) => string;
    onlyAdminsViewPending: string;
    noPendingRequests: string;
    pendingRequestsHeader: (count: number) => string;
    onlyAdminsViewMembers: string;
    communityMembersHeader: string;
    menuGuidance: string;
    callbackOnlyAdmins: string;
    callbackApproved: string;
    callbackAdded: string;
    callbackDenied: string;
    callbackAlreadyMember: string;
    callbackRequestNotFound: string;
    callbackSomethingWentWrong: string;
  };
};

const LOCALES: Record<SupportedLocale, LocaleBundle> = {
  en: {
    commands: {
      member: [
        { command: "start", description: "Open the welcome screen" },
        { command: "help", description: "Show the welcome screen" },
        { command: "join", description: "Request access to the community" },
        { command: "identify", description: "Identify a species from a photo" },
        { command: "forest", description: "Get a forest health report" },
        { command: "weather", description: "Check the weather forecast" },
        { command: "audiomoth", description: "Set up an AudioMoth recorder" },
        { command: "restart", description: "Reset this chat" },
      ],
      admin: [
        { command: "pending", description: "List pending join requests" },
        { command: "approve", description: "Approve a join request" },
        { command: "remove", description: "Remove a member" },
        { command: "members", description: "List community members" },
      ],
    },
    texts: {
      startWelcome: "🌿 <b>Hey! I'm Tainá</b> — your community biodiversity assistant.\n\nI can identify species from photos, check forest health, get weather forecasts, and set up AudioMoth recorders.",
      startAuthorizedHint: "Use the command menu below for quick actions.",
      startUnauthorizedHint: "If you want to join the community, tap Request Access below.",
      openCommands: "📋 Open Commands",
      requestAccess: "🔑 Request Access",
      joinRequestTitle: "🆕 <b>New join request</b>",
      joinRequestNameLabel: "<b>Name:</b>",
      joinRequestUsernameLabel: "<b>Username:</b>",
      joinRequestUserIdLabel: "<b>User ID:</b>",
      joinApprove: "✅ Approve",
      joinDeny: "❌ Deny",
      needJoin: "You need to join the community first! Send /join to request access 🌱",
      alreadyMember: "You're already part of the community! 🌿",
      joinRequested: "Got it! I'll let the admins know you want to join 🙌",
      pendingRequest: "You already have a pending request. Hang tight! ⏳",
      notRecognized: "Hey! 👋 I don't recognize you yet. Ask a community admin to add you, or send /join to request access.",
      onlyAdminsApprove: "Only admins can approve members.",
      noPendingToApprove: "No pending requests to approve 👍",
      multiplePendingToApprove: (count) => `There are ${count} pending requests. Use /pending to see them and approve individually.`,
      welcomeApproved: "Welcome to the community! You can now talk to me 🌿🎉",
      approvedUser: (name) => `✅ ${name} approved! They can now use the bot.`,
      approvedUserId: (userId) => `✅ User ${userId} approved! They can now use the bot.`,
      userAdded: (userId) => `✅ User ${userId} added as member.`,
      alreadyMemberId: (userId) => `User ${userId} is already a member.`,
      onlyAdminsRemove: "Only admins can remove members.",
      removeUsage: "Usage: /remove <user_id>",
      removedUser: (userId) => `Removed user ${userId}.`,
      couldNotRemoveUser: (userId) => `Could not remove user ${userId}. They may be an admin or not a member.`,
      onlyAdminsViewPending: "Only admins can view pending requests.",
      noPendingRequests: "No pending requests 👍",
      pendingRequestsHeader: (count) => `📋 <b>${count} pending request${count > 1 ? "s" : ""}:</b>`,
      onlyAdminsViewMembers: "Only admins can view the member list.",
      communityMembersHeader: "Community members:",
      menuGuidance: "Use the command menu below for /identify, /forest, /weather, and /audiomoth 🌿",
      callbackOnlyAdmins: "Only admins can do this",
      callbackApproved: "✅ Approved!",
      callbackAdded: "✅ Added as member",
      callbackDenied: "❌ Denied",
      callbackAlreadyMember: "Already a member",
      callbackRequestNotFound: "Request not found",
      callbackSomethingWentWrong: "Something went wrong 🙏",
    },
  },
  es: {
    commands: {
      member: [
        { command: "start", description: "Abrir la pantalla de bienvenida" },
        { command: "help", description: "Mostrar la pantalla de bienvenida" },
        { command: "join", description: "Pedir acceso a la comunidad" },
        { command: "identify", description: "Identificar una especie en una foto" },
        { command: "forest", description: "Obtener un informe de salud del bosque" },
        { command: "weather", description: "Consultar el pronóstico del tiempo" },
        { command: "audiomoth", description: "Configurar un registrador AudioMoth" },
        { command: "restart", description: "Reiniciar este chat" },
      ],
      admin: [
        { command: "pending", description: "Listar solicitudes pendientes" },
        { command: "approve", description: "Aprobar una solicitud" },
        { command: "remove", description: "Eliminar a un miembro" },
        { command: "members", description: "Listar miembros de la comunidad" },
      ],
    },
    texts: {
      startWelcome: "🌿 <b>¡Hola! Soy Tainá</b> — tu asistente de biodiversidad comunitaria.\n\nPuedo identificar especies en fotos, revisar la salud del bosque, ver el pronóstico del tiempo y configurar grabadoras AudioMoth.",
      startAuthorizedHint: "Usa el menú de comandos abajo para acciones rápidas.",
      startUnauthorizedHint: "Si quieres unirte a la comunidad, toca Pedir acceso abajo.",
      openCommands: "📋 Abrir comandos",
      requestAccess: "🔑 Pedir acceso",
      joinRequestTitle: "🆕 <b>Nueva solicitud de ingreso</b>",
      joinRequestNameLabel: "<b>Nombre:</b>",
      joinRequestUsernameLabel: "<b>Usuario:</b>",
      joinRequestUserIdLabel: "<b>ID de usuario:</b>",
      joinApprove: "✅ Aprobar",
      joinDeny: "❌ Denegar",
      needJoin: "¡Primero tienes que unirte a la comunidad! Envía /join para pedir acceso 🌱",
      alreadyMember: "¡Ya eres parte de la comunidad! 🌿",
      joinRequested: "¡Listo! Avisaré a los administradores que quieres unirte 🙌",
      pendingRequest: "Ya tienes una solicitud pendiente. Espera un poquito ⏳",
      notRecognized: "¡Hola! 👋 Todavía no te reconozco. Pídele a un admin de la comunidad que te agregue, o envía /join para pedir acceso.",
      onlyAdminsApprove: "Solo los administradores pueden aprobar miembros.",
      noPendingToApprove: "No hay solicitudes pendientes para aprobar 👍",
      multiplePendingToApprove: (count) => `Hay ${count} solicitudes pendientes. Usa /pending para verlas y aprobarlas una por una.`,
      welcomeApproved: "¡Bienvenido a la comunidad! Ahora puedes hablar conmigo 🌿🎉",
      approvedUser: (name) => `✅ ¡${name} aprobado! Ya puede usar el bot.`,
      approvedUserId: (userId) => `✅ ¡Usuario ${userId} aprobado! Ya puede usar el bot.`,
      userAdded: (userId) => `✅ Usuario ${userId} agregado como miembro.`,
      alreadyMemberId: (userId) => `El usuario ${userId} ya es miembro.`,
      onlyAdminsRemove: "Solo los administradores pueden eliminar miembros.",
      removeUsage: "Uso: /remove <user_id>",
      removedUser: (userId) => `Usuario ${userId} eliminado.`,
      couldNotRemoveUser: (userId) => `No pude eliminar al usuario ${userId}. Puede ser admin o no ser miembro.`,
      onlyAdminsViewPending: "Solo los administradores pueden ver las solicitudes pendientes.",
      noPendingRequests: "No hay solicitudes pendientes 👍",
      pendingRequestsHeader: (count) => `📋 <b>${count} solicitud${count > 1 ? "es" : ""} pendiente${count > 1 ? "s" : ""}:</b>`,
      onlyAdminsViewMembers: "Solo los administradores pueden ver la lista de miembros.",
      communityMembersHeader: "Miembros de la comunidad:",
      menuGuidance: "Usa el menú de comandos abajo para /identify, /forest, /weather y /audiomoth 🌿",
      callbackOnlyAdmins: "Solo los administradores pueden hacer esto",
      callbackApproved: "✅ ¡Aprobado!",
      callbackAdded: "✅ Agregado como miembro",
      callbackDenied: "❌ Denegado",
      callbackAlreadyMember: "Ya es miembro",
      callbackRequestNotFound: "Solicitud no encontrada",
      callbackSomethingWentWrong: "Algo salió mal 🙏",
    },
  },
  pt: {
    commands: {
      member: [
        { command: "start", description: "Abrir a tela de boas-vindas" },
        { command: "help", description: "Mostrar a tela de boas-vindas" },
        { command: "join", description: "Pedir acesso à comunidade" },
        { command: "identify", description: "Identificar uma espécie em uma foto" },
        { command: "forest", description: "Obter um relatório de saúde da floresta" },
        { command: "weather", description: "Ver a previsão do tempo" },
        { command: "audiomoth", description: "Configurar um gravador AudioMoth" },
        { command: "restart", description: "Reiniciar esta conversa" },
      ],
      admin: [
        { command: "pending", description: "Listar solicitações pendentes" },
        { command: "approve", description: "Aprovar uma solicitação" },
        { command: "remove", description: "Remover um membro" },
        { command: "members", description: "Listar membros da comunidade" },
      ],
    },
    texts: {
      startWelcome: "🌿 <b>Oi! Eu sou a Tainá</b> — sua assistente de biodiversidade da comunidade.\n\nPosso identificar espécies em fotos, checar a saúde da floresta, ver a previsão do tempo e configurar gravadores AudioMoth.",
      startAuthorizedHint: "Use o menu de comandos abaixo para ações rápidas.",
      startUnauthorizedHint: "Se quiser entrar na comunidade, toque em Pedir acesso abaixo.",
      openCommands: "📋 Abrir comandos",
      requestAccess: "🔑 Pedir acesso",
      joinRequestTitle: "🆕 <b>Nova solicitação de entrada</b>",
      joinRequestNameLabel: "<b>Nome:</b>",
      joinRequestUsernameLabel: "<b>Usuário:</b>",
      joinRequestUserIdLabel: "<b>ID do usuário:</b>",
      joinApprove: "✅ Aprovar",
      joinDeny: "❌ Recusar",
      needJoin: "Você precisa entrar na comunidade primeiro! Envie /join para pedir acesso 🌱",
      alreadyMember: "Você já faz parte da comunidade! 🌿",
      joinRequested: "Pronto! Vou avisar os admins que você quer entrar 🙌",
      pendingRequest: "Você já tem uma solicitação pendente. Aguenta aí ⏳",
      notRecognized: "Oi! 👋 Ainda não te reconheço. Peça para um admin da comunidade te adicionar, ou envie /join para pedir acesso.",
      onlyAdminsApprove: "Só admins podem aprovar membros.",
      noPendingToApprove: "Não há solicitações pendentes para aprovar 👍",
      multiplePendingToApprove: (count) => `Há ${count} solicitações pendentes. Use /pending para vê-las e aprovar uma por uma.`,
      welcomeApproved: "Bem-vindo à comunidade! Agora você pode falar comigo 🌿🎉",
      approvedUser: (name) => `✅ ${name} aprovado! Agora pode usar o bot.`,
      approvedUserId: (userId) => `✅ Usuário ${userId} aprovado! Agora pode usar o bot.`,
      userAdded: (userId) => `✅ Usuário ${userId} adicionado como membro.`,
      alreadyMemberId: (userId) => `O usuário ${userId} já é membro.`,
      onlyAdminsRemove: "Só admins podem remover membros.",
      removeUsage: "Uso: /remove <user_id>",
      removedUser: (userId) => `Usuário ${userId} removido.`,
      couldNotRemoveUser: (userId) => `Não consegui remover o usuário ${userId}. Ele pode ser admin ou não ser membro.`,
      onlyAdminsViewPending: "Só admins podem ver as solicitações pendentes.",
      noPendingRequests: "Sem solicitações pendentes 👍",
      pendingRequestsHeader: (count) => `📋 <b>${count} solicitaç${count > 1 ? "ões" : "ão"} pendente${count > 1 ? "s" : ""}:</b>`,
      onlyAdminsViewMembers: "Só admins podem ver a lista de membros.",
      communityMembersHeader: "Membros da comunidade:",
      menuGuidance: "Use o menu de comandos abaixo para /identify, /forest, /weather e /audiomoth 🌿",
      callbackOnlyAdmins: "Só admins podem fazer isso",
      callbackApproved: "✅ Aprovado!",
      callbackAdded: "✅ Adicionado como membro",
      callbackDenied: "❌ Negado",
      callbackAlreadyMember: "Já é membro",
      callbackRequestNotFound: "Solicitação não encontrada",
      callbackSomethingWentWrong: "Algo deu errado 🙏",
    },
  },
};

export function getTelegramLocaleBundle(locale: SupportedLocale): LocaleBundle {
  return LOCALES[locale];
}
