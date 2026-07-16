//go:build unit

package handler

import (
	"context"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestAffiliateSupervisorRequiresExactAdminAccount(t *testing.T) {
	repo := &userHandlerRepoStub{user: &service.User{
		ID:    1,
		Email: service.AffiliateSupervisorEmail,
		Role:  service.RoleAdmin,
	}}
	handler := NewUserHandler(service.NewUserService(repo, nil, nil, nil), nil, nil, nil, nil, nil)

	require.True(t, handler.isAffiliateSupervisor(context.Background(), 1))

	repo.user.Role = service.RoleUser
	require.False(t, handler.isAffiliateSupervisor(context.Background(), 1))
	repo.user.Role = service.RoleAdmin
	repo.user.Email = "other@example.com"
	require.False(t, handler.isAffiliateSupervisor(context.Background(), 1))
}
