// Публичный API примитивов новой дизайн-системы «Эфир». Импортируйте отсюда:
//   import { Button, IconButton, Avatar, toast } from "@/components/ui";
// Правила использования — design-system/DESIGN_SYSTEM.md.

export { UiRoot } from "./UiRoot";
export { cn } from "./cn";
export { Icon, ICON_NAMES, type IconName, type IconProps } from "./icons";
export { Logo } from "./Logo";

export { Button, buttonClass, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from "./IconButton";
export { Switch, type SwitchProps } from "./Switch";
export { Slider, type SliderProps, type SliderVariant } from "./Slider";
export { LevelMeter, type GateMode, type LevelMeterProps } from "./LevelMeter";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { TextField, type TextFieldProps } from "./TextField";
export { FieldShell, useFieldIds } from "./Field";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { ChoiceGroup, type Choice } from "./ChoiceGroup";
export { Tabs, TabList, Tab, TabPanel } from "./Tabs";
export { SettingRow } from "./SettingRow";

export { Dialog, type DialogProps, type DialogSize } from "./Dialog";
export { Popover, PopoverItem, type PopoverItemProps, type PopoverProps } from "./Popover";
export { Menu, MenuItem, MenuSeparator, MenuLabel, MenuConfirm, type MenuItemProps } from "./Menu";
export { Tooltip } from "./Tooltip";

export { Badge, CountBadge, type BadgeTone, type BadgeVariant } from "./Badge";
export { Kbd } from "./Kbd";
export { Card, type CardTone } from "./Card";
export { InlineAlert, type InlineAlertTone } from "./InlineAlert";
export { Spinner, Skeleton } from "./Spinner";
export { EmptyState } from "./EmptyState";
export { StateScreen } from "./StateScreen";
export {
  Avatar,
  AvatarStack,
  type AvatarProps,
  type AvatarSize,
  type AvatarStatus,
  type AvatarSurface,
} from "./Avatar";
export { SignalBars, type ConnectionQuality } from "./SignalBars";
export { QrCode } from "./QrCode";
export { Glyph, type GlyphSpec } from "./Glyph";
export { TablePreview, type TableGuest } from "./TablePreview";
export {
  Rumik,
  RUMIK_ASPECT,
  RUMIK_EXTRAS,
  RUMIK_EYES,
  RUMIK_HATS,
  RUMIK_POSES,
  rumikColorIndex,
  rumikPalette,
  type RumikColors,
  type RumikExtra,
  type RumikEyes,
  type RumikHat,
  type RumikPose,
  type RumikProps,
} from "./Rumik";
export { Toaster, toast, type ToastInput, type ToastTone } from "./Toast";

export {
  AVATAR_COLORS,
  assignAvatarColors,
  avatarColorIndex,
  avatarColorVar,
  initialsOf,
} from "./avatarColor";
export { dbToFraction, formatDb, fractionToDb, rmsToDb, METER_MIN_DB, METER_MAX_DB } from "./level";
export { computeFloatingPosition, pointRect, type Align, type Rect, type Side } from "./floating";
export { labelAbove, seatAngles, seatPoint } from "./tableLayout";
export { glueShortWords } from "./typography";
