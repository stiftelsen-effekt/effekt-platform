import { useMinsideTrpc } from "../../../../lib/trpc/useTrpcClient";
import { useState } from "react";
import { AlertCircle, Check } from "react-feather";
import { toast } from "react-toastify";
import { Donor } from "../../../../models";
import style from "./ProfileInfo.module.scss";
import { EffektButton } from "../../../shared/components/EffektButton/EffektButton";
import { EffektCheckbox } from "../../../shared/components/EffektCheckbox/EffektCheckbox";
import { useMainLocale } from "../../../../context/MainLocaleContext";
import { isProcedureAvailable } from "../../../../lib/trpc/client";

export type ProfilePageInfoConfiguration = {
  name_label: string;
  email_label: string;
  newsletter_label: string;
  save_button_label: string;
  success_message: string;
  failure_message: string;
};

export const ProfileInfo: React.FC<{
  config: ProfilePageInfoConfiguration;
  initialDonor: Donor;
}> = ({ config, initialDonor }) => {
  const trpc = useMinsideTrpc();
  const editable = isProcedureAvailable(useMainLocale(), "minside.updateProfile");
  const [donor, setDonor] = useState(initialDonor);
  const placeholder = false;
  const save = async () => {
    try {
      await trpc.minside.updateProfile.mutate({
        donorId: donor.id,
        name: donor.name ?? "",
        newsletter: donor.newsletter,
      });
      successToast(config.success_message);
    } catch {
      failureToast(config.failure_message);
    }
  };

  return (
    <>
      <section
        className={style.personalInfo}
        aria-busy={placeholder || undefined}
        data-skeleton={placeholder || undefined}
      >
        <div className={style.inputContainer}>
          {config.name_label}
          <input
            // Mounted again with the loaded name (it is uncontrolled)
            key={placeholder ? "placeholder" : "donor"}
            id={placeholder ? undefined : "name"}
            type="text"
            defaultValue={donor.name ?? undefined}
            disabled={!editable || placeholder}
            className={style.input}
            onChange={(e) => {
              setDonor({ ...donor, name: e.target.value });
            }}
          />
        </div>
        <div className={style.inputContainer}>
          {config.email_label}
          <input
            id={placeholder ? undefined : "email"}
            type="email"
            disabled
            value={donor.email}
            className={style.input}
          />
        </div>
        {editable && (
          <>
            <div className={style.inputContainer}>
              <EffektCheckbox
                dataCy={placeholder ? undefined : "checkbox-newsletter"}
                checked={donor.newsletter}
                onChange={() => {
                  if (placeholder) return;
                  setDonor({ ...donor, newsletter: !donor.newsletter });
                }}
              >
                {config.newsletter_label}
              </EffektCheckbox>
            </div>
            <EffektButton
              role={"submit"}
              onClick={save}
              cy={placeholder ? undefined : "btn-save"}
              disabled={placeholder}
            >
              {config.save_button_label}
            </EffektButton>
          </>
        )}
      </section>
    </>
  );
};

const successToast = (msg: string) =>
  toast.success(msg, { icon: <Check size={24} color={"black"} /> });
const failureToast = (msg: string) =>
  toast.error(msg, { icon: <AlertCircle size={24} color={"black"} /> });
