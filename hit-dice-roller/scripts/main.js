/**
 * Hit Dice Roller — Foundry VTT Module
 * Adds a button to the D&D 5e character sheet to roll d8 or d12 hit dice
 * separately, spending them from the character's available pool.
 */

const MODULE_ID = "hit-dice-roller";

// ─── Hook: inject button into the D&D 5e character sheet ───────────────────

Hooks.on("renderActorSheet5eCharacter", (app, html, data) => {
  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  // Find the hit dice section in the sheet
  const hdSection = html.find(".hit-dice");
  if (!hdSection.length) return;

  // Create and insert the roll button
  const btn = $(`
    <button class="hdr-roll-btn" title="Roll Hit Dice (d8 / d12)">
      <i class="fas fa-dice"></i> Roll Hit Die
    </button>
  `);

  btn.on("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openHitDiceDialog(actor);
  });

  hdSection.append(btn);
});

// ─── Dialog ─────────────────────────────────────────────────────────────────

async function openHitDiceDialog(actor) {
  const d8Available  = countAvailableHitDice(actor, "d8");
  const d12Available = countAvailableHitDice(actor, "d12");

  if (d8Available === 0 && d12Available === 0) {
    ui.notifications.warn("У вашего персонажа не осталось костей здоровья!");
    return;
  }

  const content = buildDialogContent(actor, d8Available, d12Available);

  new Dialog({
    title: "Бросок кости здоровья",
    content,
    buttons: {
      d8: {
        icon: '<i class="fas fa-dice-d8"></i>',
        label: `Бросить d8 (осталось: ${d8Available})`,
        disabled: d8Available === 0,
        callback: () => rollHitDie(actor, "d8")
      },
      d12: {
        icon: '<i class="fas fa-dice-d12"></i>',
        label: `Бросить d12 (осталось: ${d12Available})`,
        disabled: d12Available === 0,
        callback: () => rollHitDie(actor, "d12")
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Отмена"
      }
    },
    default: d8Available > 0 ? "d8" : "d12",
    render: (html) => {
      // Disable buttons with zero dice available
      if (d8Available  === 0) html.find('[data-button="d8"]').prop("disabled", true).addClass("disabled");
      if (d12Available === 0) html.find('[data-button="d12"]').prop("disabled", true).addClass("disabled");
    }
  }, {
    classes: ["dialog", "hdr-dialog"],
    width: 420
  }).render(true);
}

function buildDialogContent(actor, d8Available, d12Available) {
  const con = actor.system.abilities?.con?.mod ?? 0;
  const conSign = con >= 0 ? `+${con}` : `${con}`;
  const hp = actor.system.attributes?.hp;

  return `
    <div class="hdr-dialog-body">
      <div class="hdr-hp-info">
        <span class="hdr-label">Текущее HP:</span>
        <span class="hdr-value">${hp?.value ?? "?"} / ${hp?.max ?? "?"}</span>
      </div>
      <div class="hdr-con-info">
        <span class="hdr-label">Модификатор Телосложения:</span>
        <span class="hdr-value">${conSign}</span>
      </div>
      <hr/>
      <div class="hdr-dice-grid">
        <div class="hdr-die-card ${d8Available === 0 ? "hdr-die-empty" : ""}">
          <div class="hdr-die-icon">d8</div>
          <div class="hdr-die-count">${d8Available} шт.</div>
          <div class="hdr-die-formula">1d8 ${conSign}</div>
        </div>
        <div class="hdr-die-card ${d12Available === 0 ? "hdr-die-empty" : ""}">
          <div class="hdr-die-icon">d12</div>
          <div class="hdr-die-count">${d12Available} шт.</div>
          <div class="hdr-die-formula">1d12 ${conSign}</div>
        </div>
      </div>
      <p class="hdr-hint">Выберите кость для броска. HP будут восстановлены автоматически.</p>
    </div>
  `;
}

// ─── Core logic ──────────────────────────────────────────────────────────────

/**
 * Count how many hit dice of a given denomination are available on the actor.
 * In dnd5e the hitDice are stored as class items with system.hitDice (e.g. "d8")
 * and system.hitDiceUsed (number spent).
 */
function countAvailableHitDice(actor, denomination) {
  let available = 0;

  for (const item of actor.items) {
    if (item.type !== "class") continue;

    const hd = item.system?.hitDice ?? "";          // e.g. "d8"
    if (hd.toLowerCase() !== denomination.toLowerCase()) continue;

    const total = item.system?.levels ?? 0;
    const used  = item.system?.hitDiceUsed ?? 0;
    available  += Math.max(0, total - used);
  }

  return available;
}

/**
 * Roll a hit die of the given denomination, spend it, and apply HP recovery.
 */
async function rollHitDie(actor, denomination) {
  // Find the first class item that still has dice of this type
  const classItem = actor.items.find(i => {
    if (i.type !== "class") return false;
    const hd   = i.system?.hitDice ?? "";
    const used = i.system?.hitDiceUsed ?? 0;
    const lvl  = i.system?.levels ?? 0;
    return hd.toLowerCase() === denomination.toLowerCase() && used < lvl;
  });

  if (!classItem) {
    ui.notifications.warn(`Нет доступных костей ${denomination}!`);
    return;
  }

  // Roll the die + CON modifier
  const conMod = actor.system.abilities?.con?.mod ?? 0;
  const formula = `1${denomination} + ${conMod}`;
  const roll = new Roll(formula, actor.getRollData());
  await roll.evaluate();

  // Calculate HP recovery (minimum 1)
  const recovered = Math.max(1, roll.total);
  const hp        = actor.system.attributes.hp;
  const newHp     = Math.min(hp.max, (hp.value ?? 0) + recovered);

  // Spend the hit die
  await classItem.update({
    "system.hitDiceUsed": (classItem.system.hitDiceUsed ?? 0) + 1
  });

  // Apply HP
  await actor.update({ "system.attributes.hp.value": newHp });

  // Post roll to chat
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div class="hdr-chat-header">
        <strong>${actor.name}</strong> бросает кость здоровья <em>${denomination}</em>
      </div>
      <div class="hdr-chat-result">
        Восстановлено HP: <strong>+${recovered}</strong>
        (${hp.value} → ${newHp} / ${hp.max})
      </div>
    `,
    rollMode: game.settings.get("core", "rollMode")
  });

  ui.notifications.info(`${actor.name} восстанавливает ${recovered} HP!`);
}
