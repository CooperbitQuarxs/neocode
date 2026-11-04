import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NativeTranscriptView {
  /** NeoPi's `hideThinkingBlock`, kept per client: reasoning blocks are hidden in every native session. */
  readonly hideThinking: boolean;
}

export const useNativeTranscriptView = create(
  persist<NativeTranscriptView>(() => ({ hideThinking: false }), {
    name: "neocode-native-transcript-view",
  }),
);

export const toggleNativeThinkingVisibility = () =>
  useNativeTranscriptView.setState((state) => ({ hideThinking: !state.hideThinking }));
