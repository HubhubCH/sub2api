package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestVideoTasksMigrationContainsDurableOwnershipBinding(t *testing.T) {
	body, err := FS.ReadFile("175_video_tasks.sql")
	require.NoError(t, err)

	sql := strings.ToLower(string(body))
	for _, fragment := range []string{
		"create table if not exists video_tasks",
		"provider varchar(32) not null",
		"upstream_task_id varchar(255) not null",
		"account_id bigint not null",
		"group_id bigint not null",
		"user_id bigint not null",
		"api_key_id bigint not null",
		"expires_at timestamptz not null",
		"unique index if not exists video_tasks_provider_account_task_uq",
		"on video_tasks (provider, account_id, upstream_task_id)",
	} {
		require.Contains(t, sql, fragment)
	}
}
