import { AlertCircleIcon } from "lucide-react";
import type { AssistantTextRow } from "@zcode/shared/zcode-protocol-v4";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function PiModelErrorRow({ row }: { row: AssistantTextRow }) {
  const { intl } = useZCodeIntl();
  const message = row.error?.message ?? "";
  const connectionFailure = /fetch failed|connection (?:error|failed|refused|reset)|ECONN\w+|ENOTFOUND|ETIMEDOUT|UND_ERR_\w+|network|socket|TLS|certificate/i.test(message);
  return (
    <Alert data-testid="pi-model-error" className="my-2">
      <AlertCircleIcon />
      <AlertTitle>{intl.formatMessage({ id: connectionFailure
        ? "pi.error.connectionTitle" : "pi.error.modelTitle" })}</AlertTitle>
      <AlertDescription>
        <p>{intl.formatMessage({ id: connectionFailure
          ? "pi.error.connectionHelp" : "pi.error.modelHelp" })}</p>
        <details className="mt-2">
          <summary className="cursor-pointer">{intl.formatMessage({ id: "pi.error.details" })}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{message.slice(0, 4000)}</pre>
        </details>
      </AlertDescription>
    </Alert>
  );
}
