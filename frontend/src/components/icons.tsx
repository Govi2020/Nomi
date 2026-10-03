import type { ComponentType } from 'react'
import { HugeiconsIcon, type HugeiconsIconProps } from '@hugeicons/react'
import {
  Add01Icon,
  AudioLinesIcon,
  Bookmark01Icon,
  Brain01Icon,
  CalendarDaysIcon,
  Cancel01Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Clock01Icon,
  CodeIcon,
  CompassIcon,
  Download01Icon,
  FeatherIcon,
  FireIcon,
  FolderKanbanIcon,
  HelpCircleIcon,
  Home01Icon,
  ListViewIcon,
  LockKeyholeIcon,
  Menu01Icon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilLineIcon,
  PrinterIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Search01Icon,
  Setting06Icon,
  SparklesIcon,
  TrashIcon,
  UnderlineIcon,
  UserGroup02Icon,
  UsersIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
} from '@hugeicons/core-free-icons'

type IconProps = Omit<HugeiconsIconProps, 'icon'>
type IconComponent = ComponentType<IconProps>
export function ArtificialIntelligence({ size = 20 }: IconProps) {
  return <i className="hgi hgi-stroke hgi-rounded hgi-artificial-intelligence-08" aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }} />
}

function createIcon(icon: HugeiconsIconProps['icon']): IconComponent {
  function AppIcon(props: IconProps) {
    return <HugeiconsIcon icon={icon} color="currentColor" {...props} />
  }
  return AppIcon
}

export const Add = createIcon(Add01Icon)
export const AudioLines = createIcon(AudioLinesIcon)
export const Bookmark = createIcon(Bookmark01Icon)
export const Brain = createIcon(Brain01Icon)
export const CalendarDays = createIcon(CalendarDaysIcon)
export const Cancel = createIcon(Cancel01Icon)
export const Check = createIcon(CheckIcon)
export const ChevronDown = createIcon(ChevronDownIcon)
export const ChevronLeft = createIcon(ChevronLeftIcon)
export const ChevronRight = createIcon(ChevronRightIcon)
export const Clock = createIcon(Clock01Icon)
export const Code = createIcon(CodeIcon)
export const Compass = createIcon(CompassIcon)
export const Download = createIcon(Download01Icon)
export const Feather = createIcon(FeatherIcon)
export const Flame = createIcon(FireIcon)
export const FolderKanban = createIcon(FolderKanbanIcon)
export const HelpCircle = createIcon(HelpCircleIcon)
export const Home = createIcon(Home01Icon)
export const List = createIcon(ListViewIcon)
export const LockKeyhole = createIcon(LockKeyholeIcon)
export const Menu = createIcon(Menu01Icon)
export const MessageSquare = createIcon(Message01Icon)
export const Mic = createIcon(Mic01Icon)
export const MicOff = createIcon(MicOff01Icon)
export const MoreHorizontal = createIcon(MoreHorizontalIcon)
export const Paperclip = createIcon(PaperclipIcon)
export const PencilLine = createIcon(PencilLineIcon)
export const Printer = createIcon(PrinterIcon)
export const RefreshCw = createIcon(RefreshCwIcon)
export const RotateCcw = createIcon(RotateCcwIcon)
export const Search = createIcon(Search01Icon)
export const Settings = createIcon(Setting06Icon)
export const Sparkles = createIcon(SparklesIcon)
export const Trash = createIcon(TrashIcon)
export const Underline = createIcon(UnderlineIcon)
export const UserGroup = createIcon(UserGroup02Icon)
export const Users = createIcon(UsersIcon)
export const VolumeHigh = createIcon(VolumeHighIcon)
export const VolumeMute = createIcon(VolumeMute01Icon)
