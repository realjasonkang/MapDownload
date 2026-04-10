<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="失败记录管理"
    style="width: 800px; max-width: 90vw;"
    :bordered="false"
  >
    <n-spin :show="loading">
      <n-empty
        v-if="!loading && failedTasks.length === 0"
        description="暂无失败记录"
      />
      <n-data-table
        v-else
        :columns="columns"
        :data="failedTasks"
        :pagination="pagination"
        :row-key="(row) => row.id || row.taskId"
      />
    </n-spin>
    <template #footer>
      <div style="display: flex; justify-content: space-between;">
        <n-button
          type="error"
          :disabled="failedTasks.length === 0"
          :loading="clearing"
          @click="handleClearAll"
        >
          清空所有记录
        </n-button>
        <n-button @click="handleClose">
          关闭
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script>
import { defineComponent, h, ref, watch, computed } from 'vue';
import { NButton, NPopconfirm, NSpace, NTag, useMessage } from 'naive-ui';
import { getFailedTilesManager } from '../utils/failedTilesManager';
import { getState } from '../utils/progress';
import { retryFailedTask } from '../utils/download';

export default defineComponent({
  name: 'FailedRecordsDialog',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:show', 'retry-task'],
  setup(props, { emit }) {
    const message = useMessage();
    const loading = ref(false);
    const failedTasks = ref([]);
    const deletingTaskId = ref(null);
    const clearing = ref(false);
    const failedManager = getFailedTilesManager();

    const visible = computed({
      get: () => props.show,
      set: (val) => emit('update:show', val),
    });

    const pagination = ref({
      pageSize: 20,
    });

    const formatDate = (timestamp) => {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const loadFailedTasks = async () => {
      loading.value = true;
      try {
        await failedManager.init();
        const tasks = await failedManager.getAllFailedTasks();
        // console.log('获取到的失败任务数据:', tasks);
        // console.log('数据类型:', typeof tasks, Array.isArray(tasks));
        failedTasks.value = tasks;
        // console.log('failedTasks.value 赋值后:', failedTasks.value);
      } catch (error) {
        // console.error('加载失败任务列表失败:', error);
        message.error('加载失败任务列表失败');
      } finally {
        loading.value = false;
      }
    };

    const handleRetry = async (task) => {
      if (getState()) {
        message.warning('下载任务执行中，请稍后重试');
        return;
      }
      visible.value = false;
      await retryFailedTask(task);
    };

    const handleDelete = async (task) => {
      deletingTaskId.value = task.taskId;
      try {
        await failedManager.deleteFailedTask(task.taskId);
        message.success('删除成功');
        await loadFailedTasks();
      } catch (error) {
        console.error('删除失败任务失败:', error);
        message.error('删除失败');
      } finally {
        deletingTaskId.value = null;
      }
    };

    const handleClearAll = async () => {
      clearing.value = true;
      try {
        await failedManager.clearAll();
        message.success('清空成功');
        failedTasks.value = [];
      } catch (error) {
        console.error('清空失败记录失败:', error);
        message.error('清空失败');
      } finally {
        clearing.value = false;
      }
    };

    const handleClose = () => {
      visible.value = false;
    };

    const columns = [
      {
        title: '任务名称',
        key: 'taskName',
        ellipsis: {
          tooltip: true,
        },
      },
      {
        title: '失败/总数',
        key: 'failedCount',
        width: 120,
        render: (row) => {
          const failed = row.failedCount || 0;
          const total = row.totalTiles || 0;
          return h('span', {}, [
            h(NTag, { type: 'error', size: 'small' }, { default: () => failed }),
            ' / ',
            h(NTag, { type: 'info', size: 'small' }, { default: () => total }),
          ]);
        },
      },
      {
        title: '创建时间',
        key: 'createdAt',
        width: 160,
        render: (row) => formatDate(row.createdAt),
      },
      {
        title: '操作',
        key: 'actions',
        width: 160,
        render: (row) => {
          return h(NSpace, {}, {
            default: () => [
              h(
                NButton,
                {
                  size: 'small',
                  type: 'primary',
                  onClick: () => handleRetry(row),
                },
                { default: () => '重试' },
              ),
              h(
                NPopconfirm,
                {
                  onPositiveClick: () => handleDelete(row),
                },
                {
                  trigger: () => h(
                    NButton,
                    {
                      size: 'small',
                      type: 'error',
                      loading: deletingTaskId.value === row.taskId,
                      disabled: deletingTaskId.value !== null,
                    },
                    { default: () => '删除' },
                  ),
                  default: () => '确定删除该失败记录吗？',
                },
              ),
            ],
          });
        },
      },
    ];

    watch(
      () => props.show,
      (val) => {
        if (val) {
          loadFailedTasks();
        }
      },
    );

    return {
      visible,
      loading,
      failedTasks,
      pagination,
      columns,
      handleClearAll,
      handleClose,
      loadFailedTasks,
      deletingTaskId,
      clearing,
    };
  },
});
</script>
