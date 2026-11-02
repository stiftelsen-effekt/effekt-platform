import type { Donor } from "../../../../models";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lightbox } from "../../../shared/components/Lightbox/Lightbox";
import { EffektTextInput } from "../../../shared/components/EffektTextInput/EffektTextInput";
import { useMinsideTrpc } from "../../../../lib/trpc/useTrpcClient";
import { AlertCircle, Check } from "react-feather";
import { toast } from "react-toastify";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import { isProcedureAvailable } from "../../../../lib/trpc/client";

import styles from "./MissingNameModal.module.scss";

export type MissingNameModalConfig = {
  title: string;
  description: string;
  confirm_label: string;
  cancel_label: string;
  failure_message: string;
  success_message: string;
};

export const MissingNameModal: React.FC<{ config: MissingNameModalConfig; donor: Donor }> = ({
  config,
  donor,
}) => {
  const trpc = useMinsideTrpc();
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // The Danish backend has no route for saving the name
  const editable = isProcedureAvailable(useMainLocale(), "minside.updateProfile");
  const open = editable && Boolean(donor && !donor.name) && !dismissed;

  const saveName = async () => {
    setLoading(true);
    try {
      await trpc.minside.updateProfile.mutate({
        donorId: donor.id,
        name,
        newsletter: donor.newsletter,
      });
      successToast(config.success_message);
      setDismissed(true);
      router.refresh();
    } catch {
      failureToast(config.failure_message);
    }
    setLoading(false);
  };

  return (
    <Lightbox
      open={open}
      confirmLabel={config.confirm_label}
      onConfirm={saveName}
      valid={name.length > 0}
      loading={loading}
      cancelLabel={config.cancel_label}
      onCancel={() => setDismissed(true)}
    >
      <div className={styles.container}>
        <h5>{config.title}</h5>
        <span>{config.description}</span>
        <div className={styles.inputContainer}>
          <EffektTextInput value={name} onChange={setName} />
        </div>
      </div>
    </Lightbox>
  );
};

const successToast = (msg: string) =>
  toast.success(msg, { icon: <Check size={24} color={"black"} /> });
const failureToast = (msg: string) =>
  toast.error(msg, { icon: <AlertCircle size={24} color={"black"} /> });
