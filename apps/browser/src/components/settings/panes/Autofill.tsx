import {
  cardNetworkName,
  deleteAddress,
  deleteCard,
  getAutofillSettings,
  listAddresses,
  listCards,
  revealCardNumber,
  saveAddress,
  saveCard,
  setAutofillSettings,
  type SavedAddress,
  type SavedCard,
} from "@netnyahoo/cef";
import { confirm, copyText, Symbol } from "@netnyahoo/shell";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile } from "../../../store/model";
import { IconButton } from "../../primitives";
import { NetworkBadge } from "../../site/Autofill";
import { Button, Group, PopUp, Row, SectionHeader, Sheet, TextField, Toggle, type Option } from "../controls";
import { closeSettingsSheet, showSettingsSheet } from "../sheet";

/** Settings › Autofill: saved addresses and credit cards, per profile (Chrome's Addresses / Payment methods). */
export function AutofillPane() {
  const theme = useTheme();
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState(() => useBrowser.getState().settings.defaultProfileId);
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [enabled, setEnabled] = useState({ addresses: true, cards: true });
  const profile = engineProfile(profileId);

  const load = () => {
    void listAddresses(profile).then(setAddresses).catch(() => setAddresses([]));
    void listCards(profile).then(setCards).catch(() => setCards([]));
  };
  useEffect(load, [profileId]);
  useEffect(() => void getAutofillSettings().then(setEnabled).catch(() => {}), []);
  const toggle = (key: "addresses" | "cards", value: boolean) =>
    void setAutofillSettings({ [key]: value }).then(() => setEnabled((e) => ({ ...e, [key]: value })));

  return (
    <View>
      <SectionHeader
        title="Autofill"
        description="Addresses and cards you save are offered when you fill in a form, separately for each profile. Card numbers are kept in your macOS Keychain."
        action={
          profiles.length > 1 ? (
            <PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
          ) : undefined
        }
      />
      <Group>
        <Row title="Save and fill addresses" description="Names, addresses, email addresses and phone numbers.">
          <Toggle value={enabled.addresses} onChange={(v) => toggle("addresses", v)} />
        </Row>
        <Row title="Save and fill credit cards" description="Filling in or showing a card number asks for Touch ID or your password.">
          <Toggle value={enabled.cards} onChange={(v) => toggle("cards", v)} />
        </Row>
      </Group>

      <SectionHeader
        title="Addresses"
        action={<Button title="Add Address…" onPress={() => showSettingsSheet(<AddressSheet profile={profile} onChanged={load} />)} />}
      />
      <Group>
        {addresses && !addresses.length ? (
          <Row title="No saved addresses" description="Addresses you enter in forms can be saved here." />
        ) : (
          (addresses ?? []).map((a) => (
            <Row
              key={a.id}
              icon={<Symbol name="person.crop.circle" size={15} color={theme.icon} style={{ width: 22, height: 22 }} />}
              title={a.name || firstLine(a.street) || a.email || "Address"}
              description={addressSummary(a)}
              onPress={() => showSettingsSheet(<AddressSheet profile={profile} saved={a} onChanged={load} />)}
            />
          ))
        )}
      </Group>

      <SectionHeader
        title="Credit Cards"
        action={<Button title="Add Card…" onPress={() => showSettingsSheet(<CardSheet profile={profile} onChanged={load} />)} />}
      />
      <Group>
        {cards && !cards.length ? (
          <Row title="No saved cards" description="Cards you enter at checkout can be saved here." />
        ) : (
          (cards ?? []).map((c) => (
            <Row
              key={c.id}
              icon={<NetworkBadge network={c.network} />}
              title={`${cardNetworkName(c.network)} •••• ${c.last4}`}
              description={cardSummary(c)}
              onPress={() => showSettingsSheet(<CardSheet profile={profile} saved={c} onChanged={load} />)}
            />
          ))
        )}
      </Group>
    </View>
  );
}

const firstLine = (street?: string) => street?.split("\n")[0] ?? "";

function addressSummary(a: SavedAddress) {
  const place = [a.city, a.state, a.postalCode].filter(Boolean).join(" ");
  return [a.name ? firstLine(a.street) : "", place, a.email].filter(Boolean).join(", ");
}

const pad = (n: number) => String(n).padStart(2, "0");

function isExpired(c: SavedCard) {
  if (!c.expMonth || !c.expYear) return false;
  const now = new Date();
  return c.expYear < now.getFullYear() || (c.expYear === now.getFullYear() && c.expMonth < now.getMonth() + 1);
}

function cardSummary(c: SavedCard) {
  const expiry = c.expMonth && c.expYear ? `${isExpired(c) ? "Expired" : "Expires"} ${pad(c.expMonth)}/${pad(c.expYear % 100)}` : "";
  return [expiry, c.name].filter(Boolean).join(" · ");
}

/** "4242 4242 4242 4242"; American Express as 4-6-5. */
function formatCardNumber(digits: string) {
  const groups = /^3[47]/.test(digits) ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + g));
    i += g;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(" ");
}

function FormRow({ title, children }: { title: string; children: React.ReactNode }) {
  return <Row title={title}>{children}</Row>;
}

async function confirmDelete(title: string, message: string) {
  const { confirmed } = await confirm({ title, message, confirmTitle: "Delete", destructive: true });
  return confirmed;
}

function SheetButtons({ canDelete, onDelete, onSave, saveDisabled }: { canDelete: boolean; onDelete: () => void; onSave: () => void; saveDisabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
      {canDelete ? <Button title="Delete" kind="destructive" onPress={onDelete} /> : null}
      <View style={{ flex: 1 }} />
      <Button title="Cancel" onPress={closeSettingsSheet} />
      <Button title="Save" kind="primary" disabled={saveDisabled} onPress={onSave} />
    </View>
  );
}

const ADDRESS_FIELDS: { key: keyof SavedAddress | "line1" | "line2"; title: string }[] = [
  { key: "name", title: "Name" },
  { key: "organization", title: "Organization" },
  { key: "line1", title: "Street Address" },
  { key: "line2", title: "Apt, Suite, etc." },
  { key: "city", title: "City" },
  { key: "state", title: "State / Province" },
  { key: "postalCode", title: "ZIP / Postal Code" },
  { key: "country", title: "Country / Region" },
  { key: "phone", title: "Phone" },
  { key: "email", title: "Email" },
];

function AddressSheet({ profile, saved, onChanged }: { profile: string; saved?: SavedAddress; onChanged: () => void }) {
  const theme = useTheme();
  const [lines] = useState(() => (saved?.street ?? "").split("\n"));
  const [values, setValues] = useState<Record<string, string>>(() => ({
    name: saved?.name ?? "",
    organization: saved?.organization ?? "",
    line1: lines[0] ?? "",
    line2: lines.slice(1).join(", "),
    city: saved?.city ?? "",
    state: saved?.state ?? "",
    postalCode: saved?.postalCode ?? "",
    country: saved?.country ?? "",
    phone: saved?.phone ?? "",
    email: saved?.email ?? "",
  }));
  const set = (key: string) => (text: string) => setValues((v) => ({ ...v, [key]: text }));
  const empty = Object.values(values).every((v) => !v.trim());

  const save = async () => {
    const { line1, line2, ...rest } = values;
    const street = [line1, line2].map((l) => l!.trim()).filter(Boolean).join("\n");
    await saveAddress(profile, { ...rest, street, id: saved?.id });
    onChanged();
    closeSettingsSheet();
  };
  const remove = async () => {
    if (!saved || !(await confirmDelete("Delete this address?", "It won't be offered in forms any more."))) return;
    await deleteAddress(profile, saved.id);
    onChanged();
    closeSettingsSheet();
  };

  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{saved ? "Edit Address" : "Add Address"}</Text>
      <View style={{ marginTop: 14 }}>
        <Group>
          {ADDRESS_FIELDS.map((f, i) => (
            <FormRow key={f.key} title={f.title}>
              <TextField value={values[f.key] ?? ""} onChangeText={set(f.key)} autoFocus={i === 0 && !saved} onSubmit={() => !empty && void save()} style={{ width: 250 }} />
            </FormRow>
          ))}
        </Group>
      </View>
      <SheetButtons canDelete={!!saved} onDelete={() => void remove()} onSave={() => void save()} saveDisabled={empty} />
    </Sheet>
  );
}

const MONTHS: Option<string>[] = [{ value: "", title: "Month" }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), title: pad(i + 1) }))];
function yearOptions(current?: number): Option<string>[] {
  const now = new Date().getFullYear();
  const years = Array.from({ length: 16 }, (_, i) => now + i);
  if (current && !years.includes(current)) years.unshift(current);
  return [{ value: "", title: "Year" }, ...years.map((y) => ({ value: String(y), title: String(y) }))];
}

function CardSheet({ profile, saved, onChanged }: { profile: string; saved?: SavedCard; onChanged: () => void }) {
  const theme = useTheme();
  // A saved card's number stays hidden until Touch ID; typing a new one replaces it.
  const [number, setNumber] = useState(saved ? null : "");
  const [name, setName] = useState(saved?.name ?? "");
  const [month, setMonth] = useState(saved?.expMonth ? String(saved.expMonth) : "");
  const [year, setYear] = useState(saved?.expYear ? String(saved.expYear) : "");
  const [error, setError] = useState("");
  const digits = (number ?? "").replace(/\D/g, "");

  const reveal = async () => {
    if (!saved) return;
    const full = await revealCardNumber(profile, saved.id);
    if (full) setNumber(formatCardNumber(full));
  };
  const save = async () => {
    const card = { id: saved?.id, name: name.trim(), expMonth: month ? Number(month) : undefined, expYear: year ? Number(year) : undefined };
    const id = await saveCard(profile, card, number === null ? undefined : digits);
    if (!id) return setError("That isn't a valid card number.");
    onChanged();
    closeSettingsSheet();
  };
  const remove = async () => {
    if (!saved || !(await confirmDelete("Delete this card?", "Its number is removed from your Keychain too."))) return;
    await deleteCard(profile, saved.id);
    onChanged();
    closeSettingsSheet();
  };

  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {saved ? <NetworkBadge network={saved.network} /> : null}
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>
          {saved ? `${cardNetworkName(saved.network)} •••• ${saved.last4}` : "Add Card"}
        </Text>
      </View>
      <View style={{ marginTop: 14 }}>
        <Group>
          <FormRow title="Card Number">
            {number === null ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 13, color: theme.textPrimary }}>{`•••• •••• •••• ${saved?.last4 ?? ""}`}</Text>
                <IconButton icon="eye" size={11} box={24} radius={6} onPress={() => void reveal()} tooltip="Show Card Number" />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <TextField
                  value={number}
                  onChangeText={(t) => {
                    setError("");
                    setNumber(formatCardNumber(t.replace(/\D/g, "").slice(0, 19)));
                  }}
                  placeholder="1234 5678 9012 3456"
                  autoFocus={!saved}
                  style={{ width: saved ? 222 : 250 }}
                />
                {saved ? <IconButton icon="doc.on.doc" size={11} box={24} radius={6} onPress={() => copyText(digits)} tooltip="Copy Card Number" /> : null}
              </View>
            )}
          </FormRow>
          <FormRow title="Name on Card">
            <TextField value={name} onChangeText={setName} style={{ width: 250 }} />
          </FormRow>
          <FormRow title="Expiration Date">
            <View style={{ flexDirection: "row", gap: 6 }}>
              <PopUp value={month} options={MONTHS} onChange={setMonth} minWidth={90} />
              <PopUp value={year} options={yearOptions(saved?.expYear)} onChange={setYear} minWidth={90} />
            </View>
          </FormRow>
        </Group>
      </View>
      {error ? <Text style={{ fontSize: 12, color: "#FF453A", marginTop: 10 }}>{error}</Text> : null}
      <SheetButtons
        canDelete={!!saved}
        onDelete={() => void remove()}
        onSave={() => void save()}
        saveDisabled={number !== null && digits.length < 12}
      />
    </Sheet>
  );
}
