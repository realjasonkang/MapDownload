import {
  // create naive ui
  create,
  // component
  NMessageProvider,
  NNotificationProvider,
  NButton,
  NIcon,
  NDropdown,
  NDialog,
  NModal,
  NDescriptions,
  NDescriptionsItem,
  NPopover,
  NTree,
  NSpin,
  NSelect,
  NDataTable,
  NEmpty,
  NTag,
  NPopconfirm,
  NSpace,
} from 'naive-ui';

const naive = create({
  components: [
    NMessageProvider,
    NNotificationProvider,
    NButton,
    NIcon,
    NDropdown,
    NDialog,
    NModal,
    NDescriptions,
    NDescriptionsItem,
    NPopover,
    NTree,
    NSpin,
    NSelect,
    NDataTable,
    NEmpty,
    NTag,
    NPopconfirm,
    NSpace,
  ],
});

export default naive;
