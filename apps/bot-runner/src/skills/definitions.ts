/**
 * OpenAI Tool Calling Definitions for Companion Bot Skills.
 *
 * Implements §9B.4 of IMPLEMENTATION_PLAN.md:
 * Each skill has deterministic parameters, interruptibility, timeouts, and a result string.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const BOT_SKILL_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'say',
      description: 'Send a message in game chat for all players to see.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to say in chat.',
          },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'follow',
      description: 'Follow a player at a specified distance.',
      parameters: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
            description: 'The username of the player to follow.',
          },
          distance: {
            type: 'number',
            description: 'Distance to maintain from the player in blocks (default: 3).',
          },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'goTo',
      description: 'Navigate to target coordinates (x, y, z), a saved place name, or a player.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
          z: { type: 'number', description: 'Z coordinate' },
          place: { type: 'string', description: 'Name of a saved place (e.g. "home", "base")' },
          player: { type: 'string', description: 'Name of a player to go to' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'come',
      description: 'Navigate to the speaker who called the bot.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stay',
      description: 'Stop moving and stay at the current position.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mine',
      description: 'Find and mine a specified block type (e.g. "oak_log", "iron_ore", "stone"). Respects safety deny-list.',
      parameters: {
        type: 'object',
        properties: {
          block: {
            type: 'string',
            description: 'Block type to mine (e.g. "oak_log", "stone", "coal_ore").',
          },
          count: {
            type: 'number',
            description: 'Number of blocks to mine (default: 1, max: 64).',
          },
        },
        required: ['block'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'collect',
      description: 'Pick up dropped items on the ground within 16 blocks.',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'Optional item name to specifically collect. If omitted, collects nearest dropped items.',
          },
          count: {
            type: 'number',
            description: 'Number of items to collect (default: 1).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'craft',
      description: 'Craft an item using inventory recipes (or nearby crafting table if required).',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'Item to craft (e.g. "crafting_table", "wooden_pickaxe", "torches").',
          },
          count: {
            type: 'number',
            description: 'Number of items/batches to craft (default: 1).',
          },
        },
        required: ['item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'placeBlock',
      description: 'Place a block from inventory at the specified coordinate. Respects protected zones.',
      parameters: {
        type: 'object',
        properties: {
          block: {
            type: 'string',
            description: 'Name of the block to place from inventory (e.g. "cobblestone", "torch").',
          },
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
          z: { type: 'number', description: 'Z coordinate' },
        },
        required: ['block', 'x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attack',
      description: 'Attack a nearby hostile mob (e.g. "zombie", "skeleton", "spider"). CANNOT TARGET PLAYERS.',
      parameters: {
        type: 'object',
        properties: {
          mob: {
            type: 'string',
            description: 'Hostile mob type or entity to attack. Note: Players are strictly prohibited.',
          },
        },
        required: ['mob'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'guard',
      description: 'Guard a player, staying nearby and attacking any hostile mobs that approach them.',
      parameters: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
            description: 'Username of the player to guard.',
          },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eat',
      description: 'Eat food from inventory if hunger or health is depleted.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sleep',
      description: 'Find a nearby bed and sleep through the night.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'equip',
      description: 'Equip an item, weapon, or armor piece.',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'Item name to equip (e.g. "iron_sword", "diamond_chestplate").',
          },
          destination: {
            type: 'string',
            enum: ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'],
            description: 'Slot destination to equip the item in.',
          },
        },
        required: ['item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'give',
      description: 'Toss items from inventory to a nearby player.',
      parameters: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
            description: 'Username of the player to give items to.',
          },
          item: {
            type: 'string',
            description: 'Item name to give (e.g. "iron_ore", "bread").',
          },
          count: {
            type: 'number',
            description: 'Count of items to give (default: 1).',
          },
        },
        required: ['player', 'item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store',
      description: 'Deposit items into a chest (bot-owned chests only).',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'Item to deposit into chest.',
          },
          count: {
            type: 'number',
            description: 'Count of items to store.',
          },
        },
        required: ['item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'savePlace',
      description: 'Save current coordinates as a named place (e.g. "home", "mine", "camp").',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the location to save.',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'status',
      description: 'Get a summary of the bot vitals, location, and ongoing task.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop',
      description: 'Immediately interrupt and stop all current movements, mining, or combat.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];
