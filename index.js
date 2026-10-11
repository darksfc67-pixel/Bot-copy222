require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  ChannelType,
  SlashCommandBuilder,
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MODAL_ID = 'copy_modal';
const INPUT_ID = 'server_id';

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set([
    new SlashCommandBuilder()
      .setName('copy')
      .setDescription('Copia la estructura de otro servidor en este')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false),
  ]);
  console.log(`Bot listo como ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'copy') {
      const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle('Copiar servidor');
      const input = new TextInputBuilder()
        .setCustomId(INPUT_ID)
        .setLabel('ID SERVER')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ej: 123456789012345678')
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) {
      const id = interaction.fields.getTextInputValue(INPUT_ID).trim();

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Necesitas ser administrador.', ephemeral: true });
      }

      let source = null;
      if (/^\d{17,20}$/.test(id)) {
        source = await client.guilds.fetch(id).catch(() => null);
      }
      if (!source) {
        return interaction.reply({ content: 'Este id no es valido!!!', ephemeral: true });
      }

      await interaction.reply(`ID válido. Copiando **${source.name}**... esto puede tardar.`);
      const target = interaction.guild;
      const stats = await cloneGuild(source, target, (msg) =>
        interaction.editReply(msg).catch(() => {})
      );
      await interaction.editReply(
        `Listo. Roles: ${stats.roles}, categorías: ${stats.categories}, canales: ${stats.channels}, emojis: ${stats.emojis}` +
          (stats.errors ? ` (${stats.errors} errores)` : '')
      );
    }
  } catch (err) {
    console.error(err);
    const msg = 'Ocurrió un error al copiar el servidor.';
    if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
    else interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

async function cloneGuild(source, target, progress) {
  const stats = { roles: 0, categories: 0, channels: 0, emojis: 0, errors: 0 };
  const roleMap = new Map();
  roleMap.set(source.id, target.roles.everyone);

  await target.setName(source.name).catch(() => stats.errors++);
  const icon = source.iconURL({ size: 1024, extension: 'png' });
  if (icon) await target.setIcon(icon).catch(() => stats.errors++);

  await progress('Copiando roles...');
  const roles = [...(await source.roles.fetch()).values()]
    .filter((r) => !r.managed && r.id !== source.id)
    .sort((a, b) => b.position - a.position);

  await target.roles.everyone
    .setPermissions(source.roles.everyone.permissions)
    .catch(() => stats.errors++);

  for (const r of roles) {
    try {
      const created = await target.roles.create({
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions,
      });
      roleMap.set(r.id, created);
      stats.roles++;
    } catch {
      stats.errors++;
    }
  }

  const overwrites = (ch) =>
    [...ch.permissionOverwrites.cache.values()]
      .filter((o) => roleMap.has(o.id))
      .map((o) => ({ id: roleMap.get(o.id).id, allow: o.allow, deny: o.deny }));

  await progress('Copiando categorías y canales...');
  const all = [...(await source.channels.fetch()).values()].filter(Boolean);
  const catMap = new Map();

  const categories = all
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  for (const c of categories) {
    try {
      const created = await target.channels.create({
        name: c.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites(c),
      });
      catMap.set(c.id, created);
      stats.categories++;
    } catch {
      stats.errors++;
    }
  }

  const supported = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
  ];
  const channels = all
    .filter((c) => supported.includes(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const c of channels) {
    try {
      const options = {
        name: c.name,
        type: c.type,
        parent: c.parentId ? catMap.get(c.parentId)?.id : undefined,
        permissionOverwrites: overwrites(c),
      };
      if ('topic' in c) options.topic = c.topic ?? undefined;
      if ('nsfw' in c) options.nsfw = c.nsfw;
      if ('rateLimitPerUser' in c) options.rateLimitPerUser = c.rateLimitPerUser;
      if (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) {
        options.bitrate = Math.min(c.bitrate, target.maximumBitrate);
        options.userLimit = c.userLimit;
      }
      await target.channels.create(options);
      stats.channels++;
    } catch {
      stats.errors++;
    }
  }

  await progress('Copiando emojis...');
  for (const e of (await source.emojis.fetch()).values()) {
    try {
      await target.emojis.create({ attachment: e.imageURL(), name: e.name });
      stats.emojis++;
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

client.login(process.env.DISCORD_TOKEN);
