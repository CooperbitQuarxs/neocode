import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import {
  nativeCatalogModels,
  nativeRecord,
  nativeSessionKey,
  nativeTranscriptEntries,
  type NativeSessionTarget,
} from "@t3tools/client-runtime/neopi-native-sessions";
import { journalEntryLabel } from "@t3tools/client-runtime/neopi-journal";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import {
  getNativeDraft,
  setNativeDraft,
  nativeSessionAtoms,
  useNativeSession,
} from "../../state/neopiNativeSessions";
import { NativeField, NativeModal, NativeError } from "./NativeNeoPiControls";
import { NeoPiJournalContent } from "./NeoPiJournalContent";
import { NativeSessionMobileTree } from "./NativeSessionMobileTree";
import { NeoPiModelsEntry } from "./NeoPiModelsScreen";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

type Params = { environmentId: string; providerInstanceId: string; sessionFile: string };
type Request = ReturnType<typeof useNativeSession>["request"];
const answered = new Map<string, Set<string>>();
const editors = new Map<string, string>();
export function NativeSessionScreen({ route }: StaticScreenProps<Params>) {
  const target = useMemo(
    () => ({
      environmentId: EnvironmentId.make(route.params.environmentId),
      ref: {
        providerInstanceId: ProviderInstanceId.make(route.params.providerInstanceId),
        sessionFile: route.params.sessionFile,
      },
    }),
    [route.params.environmentId, route.params.providerInstanceId, route.params.sessionFile],
  );
  return <NativeSessionBody key={nativeSessionKey(target)} target={target} />;
}
function NativeSessionBody({ target }: { target: NativeSessionTarget }) {
  const { feed, request, draft, setDraft, error } = useNativeSession(target);
  const close = useAtomCommand(nativeSessionAtoms.close, { reportFailure: false });
  const [sending, setSending] = useState(false);
  const [paging, setPaging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [models, setModels] = useState(false);
  const [tree, setTree] = useState(false);
  const [debug, setDebug] = useState(false);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [commands, setCommands] = useState<readonly Record<string, unknown>[]>([]);
  const key = nativeSessionKey(target);
  const [dismissed, setDismissed] = useState(() => answered.get(key) ?? new Set<string>());
  const navigation = useNavigation();
  useEffect(() => {
    if (feed.session) setState(feed.session.state);
  }, [feed.session]);
  useEffect(() => {
    if (feed.session && feed.session.ref.sessionFile !== target.ref.sessionFile)
      navigation.dispatch(
        StackActions.replace("NativeSession", {
          environmentId: target.environmentId,
          ...feed.session.ref,
        }),
      );
  }, [feed.session, target.environmentId, target.ref.sessionFile, navigation]);
  const loadOlder = async () => {
    if (paging || !feed.conversation.cursor) return;
    setPaging(true);
    try {
      await request({
        type: "get_entries_page",
        scope: "branch",
        direction: "backward",
        limit: 128,
        cursor: feed.conversation.cursor,
      });
    } catch (cause) {
      setLocalError(String(cause));
    } finally {
      setPaging(false);
    }
  };
  useEffect(() => {
    if (!feed.connected) return;
    let active = true;
    void request({ type: "get_available_commands" })
      .then((value) => {
        const commands = nativeRecord(value).commands;
        if (active && Array.isArray(commands)) setCommands(commands.map(nativeRecord));
      })
      .catch((cause) => {
        if (active) setLocalError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [feed.connected, request]);
  useEffect(() => {
    if (!feed.editor || editors.get(key) === feed.editor.id) return;
    editors.set(key, feed.editor.id);
    if (!getNativeDraft(target)) setNativeDraft(target, feed.editor.text);
  }, [feed.editor, key, target]);
  const execute = useCallback<Request>(
    async (command) => {
      const result = await request(command);
      if (command.type !== "prompt" && command.type !== "extension_ui_response")
        setState(nativeRecord(await request({ type: "get_state" })));
      return result;
    },
    [request],
  );
  const send = async () => {
    const message = getNativeDraft(target);
    if (!message.trim() || sending || !feed.connected) return;
    setSending(true);
    setLocalError(null);
    try {
      await request({
        type: "prompt",
        message,
        ...(feed.busy ? { streamingBehavior: "followUp" } : {}),
      });
      if (getNativeDraft(target) === message) setDraft("");
    } catch (cause) {
      setLocalError(String(cause));
    } finally {
      setSending(false);
    }
  };
  const rows = useMemo(
    () => nativeTranscriptEntries(feed.conversation, debug),
    [feed.conversation, debug],
  );
  const model = nativeRecord(state.model);
  const suggestions =
    draft.startsWith("/") && !draft.includes(" ") && !draft.includes("\n")
      ? commands
          .filter(
            (command) => typeof command.name === "string" && `/${command.name}`.startsWith(draft),
          )
          .slice(0, 10)
      : [];
  const dialog = feed.dialogs.find(
    (dialog) => typeof dialog.id === "string" && !dismissed.has(dialog.id),
  );
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-screen"
    >
      <ScreenHeader
        title={String(state.sessionName ?? "Conversation")}
        onBack={() => navigation.navigate("Home")}
        actions={[
          {
            accessibilityLabel: "Session tree",
            icon: "arrow.triangle.branch",
            onPress: () => setTree(true),
          },
        ]}
      />
      {!feed.connected || feed.busy ? (
        <Text accessibilityLiveRegion="polite" className="px-4 py-1 text-xs text-foreground-muted">
          {feed.connected ? "Working" : "Reconnecting · showing cached conversation"}
        </Text>
      ) : null}
      <View className="px-4">
        <NativeError message={localError ?? error} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(entry) => entry.id}
        ListHeaderComponent={
          feed.conversation.cursor ? (
            <MaterialButton
              label="Load earlier messages"
              tone="text"
              disabled={paging}
              onPress={() => void loadOlder()}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <View className="gap-2 px-4 py-3">
            <Text className="text-xs font-t3-medium text-foreground-muted">
              {journalEntryLabel(item)}
            </Text>
            <NeoPiJournalContent
              entry={item}
              environmentId={target.environmentId}
              nativeRef={feed.session?.ref ?? target.ref}
              cwd={feed.session?.cwd ?? null}
            />
          </View>
        )}
      />
      <View className="gap-2 border-t border-border px-4 py-3">
        {Object.values(feed.notices)
          .filter(Boolean)
          .map((notice, index) => (
            <Text key={index} className="text-xs text-foreground-muted">
              {notice}
            </Text>
          ))}
        {suggestions.length ? (
          <ScrollView horizontal>
            {suggestions.map((command) => (
              <MaterialButton
                key={String(command.name)}
                label={`/${command.name}`}
                tone="text"
                onPress={() => setDraft(`/${command.name} `)}
              />
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          accessibilityLabel="Message NeoPi"
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask anything, or type / for commands"
          className="min-h-16 max-h-48 rounded-xl bg-card px-3 py-2 text-foreground"
        />
        <View className="flex-row flex-wrap items-center gap-2">
          <MaterialButton
            label={String(model.name ?? model.id ?? "Choose model")}
            tone="text"
            onPress={() => setModels(true)}
          />
          <MaterialButton
            label={debug ? "Hide debug" : "Debug"}
            tone="text"
            onPress={() => setDebug((value) => !value)}
          />
          {feed.busy ? (
            <MaterialButton
              label="Stop"
              tone="secondary"
              onPress={() =>
                void execute({ type: "abort" }).catch((cause) => setLocalError(String(cause)))
              }
            />
          ) : null}
          <MaterialButton
            label={sending ? "Sending…" : feed.busy ? "Queue" : "Send"}
            disabled={sending || !feed.connected || !draft.trim()}
            onPress={() => void send()}
          />
        </View>
        <NeoPiModelsEntry environmentId={target.environmentId} target={target.ref} />
        <MaterialButton
          label="Disconnect session"
          tone="text"
          onPress={() =>
            void close({ environmentId: target.environmentId, input: { ref: target.ref } }).then(
              (result) => {
                if (result._tag === "Failure")
                  setLocalError(String(squashAtomCommandFailure(result)));
                else navigation.navigate("Home");
              },
            )
          }
        />
      </View>
      {models ? <NativeMobileModels request={execute} onClose={() => setModels(false)} /> : null}
      {tree ? (
        <NativeSessionMobileTree target={target} request={execute} onClose={() => setTree(false)} />
      ) : null}
      {dialog ? (
        <NativeMobileDialog
          key={String(dialog.id)}
          dialog={dialog}
          request={request}
          onAnswered={() => {
            const next = new Set(dismissed).add(String(dialog.id));
            answered.set(key, next);
            setDismissed(next);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function NativeMobileModels({ request, onClose }: { request: Request; onClose: () => void }) {
  const [models, setModels] = useState<ReturnType<typeof nativeCatalogModels>>([]);
  const [roles, setRoles] = useState<readonly Record<string, unknown>[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([request({ type: "get_available_models" }), request({ type: "get_roles" })])
      .then(([models, roles]) => {
        if (!active) return;
        setModels(nativeCatalogModels(models));
        const items = nativeRecord(roles).roles;
        if (Array.isArray(items)) setRoles(items.map(nativeRecord));
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  const choose = async (command: Record<string, unknown> & { type: string }) => {
    if (pending) return;
    setPending(true);
    try {
      await request(command);
      onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <NativeModal title="Session model" onClose={onClose}>
      <View className="gap-3 px-4 pb-3">
        <NativeField label="Search models and roles" value={query} onChange={setQuery} />
        <NativeError message={error} />
      </View>
      <FlatList
        data={models.filter((model) =>
          `${model.name} ${model.provider}/${model.id}`.toLowerCase().includes(query.toLowerCase()),
        )}
        keyExtractor={(model) => `${model.provider}/${model.id}`}
        ListHeaderComponent={
          <View className="px-4">
            {roles
              .filter(
                (role) =>
                  role.hidden !== true &&
                  `${role.alias} ${role.name}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((role) => (
                <MaterialButton
                  key={String(role.id)}
                  label={String(role.alias ?? role.id)}
                  disabled={pending}
                  tone="text"
                  onPress={() => void choose({ type: "set_role", role: role.id })}
                />
              ))}
          </View>
        }
        renderItem={({ item }) => (
          <View className="px-4 py-1">
            <MaterialButton
              label={`${item.name} · ${item.provider}`}
              disabled={pending}
              tone="text"
              onPress={() =>
                void choose({ type: "set_model", provider: item.provider, modelId: item.id })
              }
            />
          </View>
        )}
      />
    </NativeModal>
  );
}

function NativeMobileDialog({
  dialog,
  request,
  onAnswered,
}: {
  dialog: Record<string, unknown>;
  request: Request;
  onAnswered: () => void;
}) {
  const [value, setValue] = useState(typeof dialog.prefill === "string" ? dialog.prefill : "");
  const [answers, setAnswers] = useState<
    Record<string, { selectedOptions: string[]; customInput: string }>
  >({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toolApproval = dialog.type === "tool_approval_request";
  const planProposal = dialog.type === "plan_proposal_request";
  const responseType = toolApproval
    ? "tool_approval_response"
    : planProposal
      ? "plan_proposal_response"
      : "extension_ui_response";
  const respond = async (fields: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    try {
      await request({ type: responseType, id: dialog.id, ...fields });
      onAnswered();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  const cancel = () =>
    respond(
      planProposal
        ? { decision: "refine", feedback: value || "Plan review cancelled." }
        : { cancelled: true },
    );
  const questions = Array.isArray(dialog.questions) ? dialog.questions.map(nativeRecord) : [];
  return (
    <NativeModal
      title={String(dialog.title ?? (toolApproval ? `Allow ${dialog.toolName}?` : "NeoPi asks"))}
      onClose={() => void cancel()}
    >
      <ScrollView contentContainerClassName="gap-3 px-4 pb-6">
        <NativeError message={error} />
        {dialog.message ? <Text className="text-foreground">{String(dialog.message)}</Text> : null}
        {toolApproval ? (
          <>
            {typeof dialog.reason === "string" ? (
              <Text className="text-foreground">{dialog.reason}</Text>
            ) : null}
            <Text selectable className="font-mono text-xs text-foreground">
              {JSON.stringify(dialog.args, null, 2)}
            </Text>
            {Array.isArray(dialog.details)
              ? dialog.details.map((detail, index) => (
                  <Text key={index} className="text-foreground">
                    {String(detail)}
                  </Text>
                ))
              : null}
            {Array.isArray(dialog.safetyChecks)
              ? dialog.safetyChecks.map((item, index) => {
                  const check = nativeRecord(item);
                  return (
                    <Text key={index} accessibilityRole="alert" className="text-danger-foreground">
                      {String(check.message ?? check.code ?? check.id)}
                    </Text>
                  );
                })
              : null}
            <MaterialButton
              label="Deny"
              tone="secondary"
              disabled={pending}
              onPress={() => void respond({ decision: "deny" })}
            />
            {!Array.isArray(dialog.safetyChecks) || dialog.safetyChecks.length === 0 ? (
              <MaterialButton
                label="Allow for session"
                tone="secondary"
                disabled={pending}
                onPress={() => void respond({ decision: "allow_session" })}
              />
            ) : null}
            <MaterialButton
              label="Allow once"
              disabled={pending}
              onPress={() => void respond({ decision: "allow_once" })}
            />
          </>
        ) : null}
        {planProposal ? (
          <>
            <Text selectable className="text-foreground">
              {String(dialog.planMarkdown ?? "")}
            </Text>
            <NativeField label="Plan feedback" multiline value={value} onChange={setValue} />
            <MaterialButton
              label="Refine"
              tone="secondary"
              disabled={pending}
              onPress={() => void respond({ decision: "refine", feedback: value })}
            />
            <MaterialButton
              label="Approve plan"
              disabled={pending}
              onPress={() => void respond({ decision: "approve" })}
            />
          </>
        ) : null}
        {dialog.method === "select" && Array.isArray(dialog.options)
          ? dialog.options.map((option, index) => (
              <MaterialButton
                key={index}
                label={String(option)}
                disabled={pending}
                tone="secondary"
                onPress={() => void respond({ value: option })}
              />
            ))
          : null}
        {dialog.method === "confirm" ? (
          <>
            <MaterialButton
              label="Yes"
              disabled={pending}
              onPress={() => void respond({ confirmed: true })}
            />
            <MaterialButton
              label="No"
              disabled={pending}
              tone="secondary"
              onPress={() => void respond({ confirmed: false })}
            />
          </>
        ) : null}
        {dialog.method === "input" || dialog.method === "editor" ? (
          <>
            <NativeField
              label={String(dialog.title ?? "Answer")}
              value={value}
              onChange={setValue}
              secret={dialog.secret === true}
              multiline={dialog.method === "editor"}
            />
            <MaterialButton
              label="Submit"
              disabled={pending}
              onPress={() => void respond({ value })}
            />
          </>
        ) : null}
        {questions.map((question) => {
          const id = String(question.id);
          const answer = answers[id] ?? { selectedOptions: [], customInput: "" };
          return (
            <View key={id} className="gap-2">
              <Text className="font-t3-medium text-foreground">{String(question.question)}</Text>
              {(Array.isArray(question.options) ? question.options : []).map((item, index) => {
                const option = nativeRecord(item);
                const label = String(option.label);
                return (
                  <MaterialButton
                    key={index}
                    label={`${answer.selectedOptions.includes(label) ? "✓ " : ""}${label}`}
                    tone="secondary"
                    disabled={pending}
                    onPress={() =>
                      setAnswers({
                        ...answers,
                        [id]: {
                          ...answer,
                          selectedOptions: question.multi
                            ? answer.selectedOptions.includes(label)
                              ? answer.selectedOptions.filter((value) => value !== label)
                              : [...answer.selectedOptions, label]
                            : [label],
                        },
                      })
                    }
                  />
                );
              })}
              <NativeField
                label="Other answer"
                value={answer.customInput}
                onChange={(customInput) =>
                  setAnswers({ ...answers, [id]: { ...answer, customInput } })
                }
              />
            </View>
          );
        })}
        {dialog.method === "ask" ? (
          <MaterialButton
            label="Submit answers"
            disabled={pending}
            onPress={() =>
              void respond({
                answers: questions.map((question) => ({
                  id: question.id,
                  ...(answers[String(question.id)] ?? { selectedOptions: [], customInput: "" }),
                })),
              })
            }
          />
        ) : null}
        <MaterialButton
          label="Cancel"
          tone="text"
          disabled={pending}
          onPress={() => void cancel()}
        />
      </ScrollView>
    </NativeModal>
  );
}
