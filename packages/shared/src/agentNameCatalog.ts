/**
 * The names an agent session can carry. Replacing this list is the whole job of
 * curating it: `agentNames.ts` only needs the exported array, and a name's
 * entry decides its pronouns. Names must stay unique (case-insensitively) across
 * origins; `agentNames.test.ts` enforces that and the minimum size.
 */

export type AgentNameOrigin =
  | "astronomy"
  | "greek"
  | "roman"
  | "norse"
  | "hindu"
  | "persian"
  | "tes";

export type AgentNameGender = "she" | "he";

export interface AgentNameEntry {
  readonly name: string;
  readonly gender: AgentNameGender;
  readonly origin: AgentNameOrigin;
}

/** One group of names sharing an origin and a gender, written as a comma-separated list. */
const group = (
  origin: AgentNameOrigin,
  gender: AgentNameGender,
  names: string,
): readonly AgentNameEntry[] =>
  names.split(",").map((name) => ({ name: name.trim(), gender, origin }));

// Sifted from a larger candidate list: three models (Claude Opus 5.5, GPT-6.1 Sol, DeepSeek V4.1 Flash)
// each chose the names they liked as session names, and only names chosen by at least two are kept.
export const AGENT_NAME_CATALOG: readonly AgentNameEntry[] = [
  ...group(
    "astronomy",
    "she",
    "Ceres, Vesta, Pallas, Juno, Io, Europa, Callisto, Phoebe, Calypso, Titania, Miranda, Rosalind, Vega, Capella, Spica, Polaris, Alcyone, Maia, Electra, Andromeda, Cassiopeia, Lyra, Nova",
  ),
  ...group(
    "astronomy",
    "he",
    "Mercury, Ganymede, Atlas, Oberon, Ariel, Triton, Sirius, Arcturus, Rigel, Altair, Antares, Castor, Regulus, Orion, Perseus",
  ),
  ...group(
    "greek",
    "she",
    "Athena, Artemis, Hestia, Persephone, Eos, Selene, Themis, Metis, Nyx, Iris, Mnemosyne, Calliope, Clio, Thalia, Harmonia, Ariadne, Penelope",
  ),
  ...group("greek", "he", "Apollo, Hermes, Helios, Zephyrus, Orpheus"),
  ...group("roman", "she", "Minerva, Diana, Flora, Fortuna, Aurora, Victoria, Luna, Pomona"),
  ...group("roman", "he", "Silvanus, Sol"),
  ...group("norse", "she", "Frigg, Freyja, Sif, Idun, Eir, Skadi, Saga, Verdandi, Skuld, Embla"),
  ...group(
    "norse",
    "he",
    "Odin, Thor, Baldr, Tyr, Heimdall, Freyr, Bragi, Mimir, Kvasir, Huginn, Muninn",
  ),
  ...group("hindu", "she", "Lakshmi, Saraswati, Parvati, Radha, Ushas, Uma, Tara"),
  ...group("hindu", "he", "Krishna, Indra, Agni, Vayu, Varuna, Surya, Soma, Garuda, Arjuna"),
  ...group("persian", "she", "Anahita, Armaiti, Daena, Ashi, Simurgh, Rudabeh"),
  ...group("persian", "he", "Mithra, Atar, Rostam, Zal, Faridun, Arash, Bahram, Tir"),
  ...group(
    "tes",
    "she",
    "Dibella, Kynareth, Mara, Nirni, Khenarthi, Kyne, Alessia, Almalexia, Tava, Morwha, Secunda, Jone, Azura, Meridia, Nocturnal, Ithelia",
  ),
  ...group(
    "tes",
    "he",
    "Akatosh, Arkay, Julianos, Stendarr, Zenithar, Talos, Auri-El, Trinimac, Y'ffre, Magnus, Xarxes, Jhunal, Phynaster, Lorkhan, Shor, Ysmir, Tsun, Syrabane, Satakal, Alkosh, Morihaus, Pelinal, Onsi, Baan Dar, Masser, Anu, Hermaeus Mora, Sheogorath, Vivec, Sotha Sil, Barbas, Nerevar, Vanus Galerion, Paarthurnax",
  ),
];
