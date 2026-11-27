import { InputHTMLAttributes } from "react";
import styles from "./EffektTextInput.module.scss";

export const EffektTextInput: React.FC<
  {
    value: string | undefined;
    onChange: (val: string) => void;
    name?: string;
    type?: string;
    placeholder?: string;
    denomination?: string;
    variant?: "rounded" | "underlined";
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">
> = ({ value, onChange, name, type, placeholder, denomination, variant, ...inputProps }) => {
  return (
    <div className={[styles.textInputWrapper, styles[variant || "rounded"]].join(" ")}>
      <input
        {...inputProps}
        className={styles.textInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        name={name}
        type={type}
      ></input>
      {denomination && <span className={styles.denomination}>{denomination}</span>}
    </div>
  );
};
