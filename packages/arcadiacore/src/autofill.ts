import { Cef, valueOr } from "./native";

export type SavedAddress = {
  id: string;
  name?: string;
  organization?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  created: number;
  modified: number;
};
export type AddressInput = Partial<Omit<SavedAddress, "created" | "modified">>;

export type CardNetwork = "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "card";
export type SavedCard = {
  id: string;
  name?: string;
  network: CardNetwork;
  last4: string;
  expMonth?: number;
  expYear?: number;
  created: number;
  modified: number;
};
export type CardInput = { id?: string; name?: string; expMonth?: number; expYear?: number };

export const getAutofillSettings = (profile = "") => Cef.getAutofillSettings(profile);
export const setAutofillSettings = (settings: { addresses?: boolean; cards?: boolean }, profile = "") =>
  Cef.setAutofillSettings(profile, settings.addresses ?? null, settings.cards ?? null);
export const listAddresses = async (profile: string): Promise<SavedAddress[]> =>
  valueOr(await Cef.listAddresses(profile), { addresses: [] }).addresses;
export const saveAddress = async (profile: string, address: AddressInput) =>
  valueOr(await Cef.saveAddress(profile, address), { id: null }).id;
export const deleteAddress = async (profile: string, id: string) => {
  valueOr(await Cef.deleteAutofillEntry(profile, id), null);
};
export const listCards = async (profile: string): Promise<SavedCard[]> => valueOr(await Cef.listCards(profile), { cards: [] }).cards;
export const saveCard = async (profile: string, card: CardInput, number?: string) =>
  valueOr(await Cef.saveCard(profile, card, number ?? null), { id: null }).id;
export const deleteCard = async (profile: string, id: string) => {
  valueOr(await Cef.deleteAutofillEntry(profile, id), null);
};
export const revealCardNumber = async (profile: string, id: string) =>
  valueOr(await Cef.revealCardNumber(profile, id), { number: null }).number ?? null;

const NETWORK_NAMES: Record<CardNetwork, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  card: "Card",
};
export const cardNetworkName = (network: CardNetwork) => NETWORK_NAMES[network] ?? "Card";
