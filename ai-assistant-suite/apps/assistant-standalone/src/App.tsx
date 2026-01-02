import { AssistantRoot } from "@assistant/ui";

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h1>Standalone Shell</h1>
      <p>Assistant overlay appears bottom-right.</p>

      <AssistantRoot
        mode="standalone"
        onSend={async ({ inputText, explainMode, attachments }) => {
          return {
            assistantText:
              `✅ Stub response\n\nExplainMode=${explainMode}\nInput=${inputText}\nAttachments=${attachments.length}`
          };
        }}
        onResync={async () => {
          return { assistantText: "✅ Stub Re-sync: would capture current screen and regenerate corrected steps." };
        }}
      />
    </div>
  );
}
