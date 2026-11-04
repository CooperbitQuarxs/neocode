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

export const AGENT_NAME_CATALOG: readonly AgentNameEntry[] = [
  // Planets, dwarf planets, moons: by the gender of the deity or figure they carry.
  ...group("astronomy", "she", "Venus, Ceres, Eris, Haumea, Sedna, Vesta, Pallas, Juno, Hygiea"),
  ...group(
    "astronomy",
    "he",
    "Mercury, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Makemake, Quaoar, Orcus",
  ),
  ...group(
    "astronomy",
    "she",
    "Io, Europa, Callisto, Amalthea, Rhea, Dione, Tethys, Phoebe, Pandora, Calypso, Titania, Miranda, Juliet, Portia, Rosalind, Nereid",
  ),
  ...group(
    "astronomy",
    "he",
    "Ganymede, Titan, Iapetus, Enceladus, Janus, Prometheus, Atlas, Pan, Oberon, Ariel, Puck, Triton, Charon, Phobos, Deimos",
  ),
  // Bright stars and star clusters' members.
  ...group(
    "astronomy",
    "she",
    "Vega, Capella, Spica, Bellatrix, Polaris, Alcyone, Maia, Electra, Merope, Proxima",
  ),
  ...group(
    "astronomy",
    "he",
    "Sirius, Canopus, Arcturus, Rigel, Procyon, Achernar, Betelgeuse, Altair, Aldebaran, Antares, Pollux, Castor, Fomalhaut, Deneb, Regulus, Alphard, Algol, Albireo, Thuban",
  ),
  // Constellations.
  ...group("astronomy", "she", "Andromeda, Cassiopeia, Carina, Lyra, Vela, Nova"),
  ...group(
    "astronomy",
    "he",
    "Orion, Cygnus, Aquila, Draco, Perseus, Pegasus, Cepheus, Auriga, Halley",
  ),

  // Greek: Olympians, Titans, primordials, Muses, Horae, and lesser deities.
  ...group(
    "greek",
    "she",
    "Hera, Demeter, Athena, Artemis, Aphrodite, Hestia, Persephone, Hecate, Nike, Eos, Selene, Gaia, Themis, Metis, Leto, Nyx, Iris, Hebe, Tyche, Hygieia, Mnemosyne, Amphitrite, Thetis, Calliope, Clio, Erato, Melpomene, Thalia, Harmonia, Ananke, Circe, Ariadne, Cassandra, Penelope",
  ),
  ...group(
    "greek",
    "he",
    "Zeus, Poseidon, Hades, Apollo, Ares, Hermes, Hephaestus, Dionysus, Helios, Hypnos, Morpheus, Nereus, Cronus, Oceanus, Aeolus, Boreas, Zephyrus, Heracles, Orpheus",
  ),

  // Roman.
  ...group(
    "roman",
    "she",
    "Minerva, Diana, Proserpina, Flora, Fortuna, Aurora, Victoria, Bellona, Pax, Luna, Pomona, Fauna, Cybele, Terra",
  ),
  ...group(
    "roman",
    "he",
    "Vulcan, Bacchus, Cupid, Faunus, Silvanus, Quirinus, Sol, Somnus, Vertumnus, Terminus, Mithras, Hercules",
  ),

  // Norse and wider Germanic.
  ...group(
    "norse",
    "she",
    "Frigg, Freyja, Sif, Idun, Eir, Sigyn, Skadi, Nanna, Gerd, Ran, Gefjon, Saga, Jord, Urd, Verdandi, Skuld, Angrboda, Embla, Nerthus",
  ),
  ...group(
    "norse",
    "he",
    "Odin, Thor, Loki, Baldr, Tyr, Heimdall, Njord, Freyr, Bragi, Vidar, Vali, Ullr, Hoenir, Mimir, Aegir, Kvasir, Ymir, Surtr, Fenrir, Sleipnir, Huginn, Muninn, Mani, Sindri",
  ),

  // Hindu.
  ...group(
    "hindu",
    "she",
    "Lakshmi, Saraswati, Parvati, Durga, Kali, Sita, Radha, Ganga, Yamuna, Ushas, Shakti, Uma, Tara, Draupadi",
  ),
  ...group(
    "hindu",
    "he",
    "Vishnu, Shiva, Brahma, Ganesha, Hanuman, Krishna, Rama, Indra, Agni, Vayu, Varuna, Surya, Soma, Kartikeya, Skanda, Murugan, Kubera, Yama, Garuda, Arjuna, Rudra, Nandi, Shani",
  ),

  // Persian: Zoroastrian yazatas, Amesha Spentas, and Shahnameh figures.
  ...group(
    "persian",
    "she",
    "Anahita, Armaiti, Daena, Ashi, Haurvatat, Ameretat, Simurgh, Rudabeh, Tahmineh, Aban",
  ),
  ...group(
    "persian",
    "he",
    "Ahura Mazda, Mithra, Atar, Tishtrya, Zurvan, Haoma, Sraosha, Rashnu, Verethragna, Vohu Manah, Khshathra Vairya, Apam Napat, Rostam, Zal, Faridun, Jamshid, Arash, Bahram, Tir",
  ),

  // The Elder Scrolls: Aedra and the divines.
  ...group(
    "tes",
    "she",
    "Dibella, Kynareth, Mara, Nirni, Khenarthi, Mafala, Kyne, Alessia, Almalexia, Tava, Leki, Morwha, Diagna, Secunda, Jone",
  ),
  ...group(
    "tes",
    "he",
    "Akatosh, Arkay, Julianos, Stendarr, Zenithar, Talos, Auri-El, Trinimac, Y'ffre, Magnus, Xarxes, Jhunal, Phynaster, Lorkhan, Shor, Ysmir, Sep, Tsun, Stuhn, Syrabane, Ruptga, Satakal, Alkosh, Lorkhaj, Orkey, Morihaus, Pelinal, Zeht, Onsi, Tu'whacca, Baan Dar, Magrus, Masser, Jode, Anu, Padomay, Sithis",
  ),
  // The Elder Scrolls: Daedric Princes and the Tribunal.
  ...group("tes", "she", "Azura, Mephala, Meridia, Namira, Nocturnal, Vaermina, Ithelia"),
  ...group(
    "tes",
    "he",
    "Boethiah, Clavicus Vile, Hermaeus Mora, Hircine, Jyggalag, Malacath, Mehrunes Dagon, Molag Bal, Peryite, Sanguine, Sheogorath, Vivec, Sotha Sil, Barbas, Merrunz, Nerevar, Vanus Galerion, Mannimarco, Paarthurnax",
  ),
];
